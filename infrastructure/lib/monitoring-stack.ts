import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface MonitoringStackProps extends cdk.StackProps {
	stage: string;
	alarmEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
	public readonly alarmTopic: sns.Topic;

	constructor(scope: Construct, id: string, props: MonitoringStackProps) {
		super(scope, id, props);

		if (!process.env.PROJECT_NAME) {
			throw new Error("PROJECT_NAME environment variable is required");
		}
		const projectName = process.env.PROJECT_NAME;

		// SNS topic for alarms
		this.alarmTopic = new sns.Topic(this, "AlarmTopic", {
			topicName: `${projectName}-${props.stage}-alarms`,
			displayName: `${projectName} ${props.stage} API Alarms`,
		});

		// Subscribe email if provided
		if (props.alarmEmail) {
			this.alarmTopic.addSubscription(
				new snsSubscriptions.EmailSubscription(props.alarmEmail),
			);
		}

		const graphqlFnName = `${projectName}-${props.stage}-graphql`;

		// Lambda log groups and their retention are owned by the stacks that create
		// the functions, via LogRetentionAspect (see ApiStack/DatabaseStack). This
		// stack must NOT create /aws/lambda/<fn> log groups itself: Lambda auto-creates
		// that group on first invocation, so a CDK LogGroup with the same name collides
		// ("AWS::Logs::LogGroup already exists") and blocks every deploy. We only need
		// the name as a string for the dashboard widget below.
		const apiLogGroupName = `/aws/lambda/${graphqlFnName}`;

		// Dashboard for monitoring
		const dashboard = new cloudwatch.Dashboard(this, "ApiDashboard", {
			dashboardName: `${projectName}-${props.stage}-api-dashboard`,
		});

		// Add text widget referencing the log group
		dashboard.addWidgets(
			new cloudwatch.TextWidget({
				markdown: `## API Logs\n\nLog Group: ${apiLogGroupName}\n\nUse CloudWatch Logs Insights to query this log group for errors and debugging.`,
				width: 24,
				height: 3,
			}),
		);

		// API Gateway HTTP API v2 metrics — alarms are created in ApiStack where
		// the HttpApi construct is available (needed for correct ApiId dimension).
		// MonitoringStack only handles Lambda-level and account-wide alarms.

		// Lambda error rate metric — scoped to the primary GraphQL function
		const lambdaErrorMetric = new cloudwatch.Metric({
			namespace: "AWS/Lambda",
			metricName: "Errors",
			dimensionsMap: { FunctionName: graphqlFnName },
			statistic: "Sum",
			period: cdk.Duration.minutes(5),
		});

		// Lambda p95 latency metric — scoped to the primary GraphQL function
		const lambdaLatencyMetric = new cloudwatch.Metric({
			namespace: "AWS/Lambda",
			metricName: "Duration",
			dimensionsMap: { FunctionName: graphqlFnName },
			statistic: "p95",
			period: cdk.Duration.minutes(5),
		});

		// Alarm for Lambda errors
		const lambdaErrorAlarm = new cloudwatch.Alarm(this, "LambdaErrorAlarm", {
			metric: lambdaErrorMetric,
			threshold: 10,
			evaluationPeriods: 2,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			alarmDescription: "Lambda error rate is too high",
		});

		lambdaErrorAlarm.addAlarmAction(
			new cloudwatchActions.SnsAction(this.alarmTopic),
		);

		// Alarm for Lambda p95 latency
		const lambdaLatencyAlarm = new cloudwatch.Alarm(
			this,
			"LambdaLatencyAlarm",
			{
				metric: lambdaLatencyMetric,
				threshold: 3000, // 3 seconds
				evaluationPeriods: 2,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
				alarmDescription: "Lambda p95 latency is too high",
			},
		);

		lambdaLatencyAlarm.addAlarmAction(
			new cloudwatchActions.SnsAction(this.alarmTopic),
		);

		// Account-wide Lambda Concurrency Alarm
		const concurrencyLimit = 1000; // Default AWS limit (update after requesting increase)
		const concurrencyThreshold = concurrencyLimit * 0.7; // Alert at 70%

		const concurrencyMetric = new cloudwatch.Metric({
			namespace: "AWS/Lambda",
			metricName: "ConcurrentExecutions",
			statistic: "Maximum",
			period: cdk.Duration.minutes(1),
		});

		const concurrencyAlarm = new cloudwatch.Alarm(
			this,
			"LambdaConcurrencyAlarm",
			{
				metric: concurrencyMetric,
				threshold: concurrencyThreshold,
				evaluationPeriods: 2,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
				alarmDescription: `Lambda concurrent executions > ${concurrencyThreshold} (70% of ${concurrencyLimit} limit)`,
			},
		);

		concurrencyAlarm.addAlarmAction(
			new cloudwatchActions.SnsAction(this.alarmTopic),
		);

		// Account-wide Lambda Throttle Alarm
		const throttleMetric = new cloudwatch.Metric({
			namespace: "AWS/Lambda",
			metricName: "Throttles",
			statistic: "Sum",
			period: cdk.Duration.minutes(5),
		});

		const accountThrottleAlarm = new cloudwatch.Alarm(
			this,
			"LambdaAccountThrottleAlarm",
			{
				metric: throttleMetric,
				threshold: 10,
				evaluationPeriods: 1,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
				alarmDescription:
					"Lambda functions throttled due to account concurrency limit",
			},
		);

		accountThrottleAlarm.addAlarmAction(
			new cloudwatchActions.SnsAction(this.alarmTopic),
		);

		// Add widgets to dashboard
		dashboard.addWidgets(
			new cloudwatch.GraphWidget({
				title: "Lambda Concurrent Executions (Account-wide)",
				left: [concurrencyMetric],
				width: 24,
				height: 6,
				leftYAxis: {
					min: 0,
					max: concurrencyLimit,
					label: "Concurrent Executions",
				},
			}),
		);

		dashboard.addWidgets(
			new cloudwatch.GraphWidget({
				title: "Lambda Errors",
				left: [lambdaErrorMetric.with({ color: cloudwatch.Color.RED })],
				width: 12,
			}),
			new cloudwatch.GraphWidget({
				title: "Lambda Duration (p95)",
				left: [lambdaLatencyMetric],
				width: 12,
			}),
		);

		dashboard.addWidgets(
			new cloudwatch.GraphWidget({
				title: "Lambda Throttles (Account-wide)",
				left: [throttleMetric.with({ color: cloudwatch.Color.ORANGE })],
				width: 24,
			}),
		);

		// ============================================
		// WEBHOOK DLQ MONITORING
		// ============================================
		// Monitor webhook Dead Letter Queue for failed webhook processing
		const webhookDLQMetric = new cloudwatch.Metric({
			namespace: "AWS/SQS",
			metricName: "ApproximateNumberOfMessagesVisible",
			dimensionsMap: {
				QueueName: `${projectName}-${props.stage}-webhook-dlq`,
			},
			statistic: "Maximum",
			period: cdk.Duration.minutes(5),
		});

		// Alarm when ANY messages appear in DLQ (indicates webhook failures)
		const dlqAlarm = new cloudwatch.Alarm(this, "WebhookDLQAlarm", {
			alarmName: `${projectName}-${props.stage}-webhook-dlq-messages`,
			alarmDescription:
				"Webhook DLQ has messages - webhooks are failing and need investigation",
			metric: webhookDLQMetric,
			threshold: 1, // Alert if ANY messages in DLQ
			evaluationPeriods: 1,
			comparisonOperator:
				cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
		});

		dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

		// Add DLQ widget to dashboard
		dashboard.addWidgets(
			new cloudwatch.GraphWidget({
				title: "Webhook DLQ Messages (Failed Webhooks)",
				left: [
					webhookDLQMetric.with({
						color: cloudwatch.Color.RED,
						label: "Failed Webhooks",
					}),
				],
				width: 24,
				height: 6,
				leftAnnotations: [
					{
						value: 0,
						label: "No Failures",
						color: cloudwatch.Color.GREEN,
					},
				],
			}),
		);

		// Outputs
		new cdk.CfnOutput(this, "AlarmTopicArn", {
			value: this.alarmTopic.topicArn,
			description: "ARN of SNS topic for alarms",
		});

		new cdk.CfnOutput(this, "DashboardUrl", {
			value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
			description: "CloudWatch Dashboard URL",
		});
	}
}
