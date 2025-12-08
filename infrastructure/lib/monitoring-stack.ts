import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  stage: string;
  alarmEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;

    // SNS topic for alarms
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${projectName}-${props.stage}-alarms`,
      displayName: `${projectName} ${props.stage} API Alarms`,
    });

    // Subscribe email if provided
    if (props.alarmEmail) {
      alarmTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(props.alarmEmail)
      );
    }

    // Log group for centralized logging with environment-specific retention
    const retention = 
      props.stage === 'production' ? logs.RetentionDays.ONE_MONTH :
      logs.RetentionDays.ONE_WEEK; // staging

    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/${projectName}-${props.stage}-api`,
      retention: retention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Dashboard for monitoring
    const dashboard = new cloudwatch.Dashboard(this, 'ApiDashboard', {
      dashboardName: `${projectName}-${props.stage}-api-dashboard`,
    });

    // Add text widget referencing the log group
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `## API Logs\n\nLog Group: ${apiLogGroup.logGroupName}\n\nUse CloudWatch Logs Insights to query this log group for errors and debugging.`,
        width: 24,
        height: 3
      })
    );

    // API Gateway metrics
    const apiRequestMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: {
        ApiName: `${projectName}-${props.stage}-api`,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api4xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4XXError',
      dimensionsMap: {
        ApiName: `${projectName}-${props.stage}-api`,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: `${projectName}-${props.stage}-api`,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // Alarm for API Gateway 5xx errors (> 1% error rate)
    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmName: `${projectName}-${props.stage}-api-high-5xx-rate`,
      alarmDescription: 'API Gateway 5xx error rate > 1%',
      metric: new cloudwatch.MathExpression({
        expression: '(m1/m2)*100',
        usingMetrics: {
          m1: api5xxMetric,
          m2: apiRequestMetric,
        },
      }),
      threshold: 1,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    api5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Alarm for API Gateway 4xx errors (> 10% error rate)
    const api4xxAlarm = new cloudwatch.Alarm(this, 'Api4xxAlarm', {
      alarmName: `${projectName}-${props.stage}-api-high-4xx-rate`,
      alarmDescription: 'API Gateway 4xx error rate > 10%',
      metric: new cloudwatch.MathExpression({
        expression: '(m1/m2)*100',
        usingMetrics: {
          m1: api4xxMetric,
          m2: apiRequestMetric,
        },
      }),
      threshold: 10,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    api4xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Lambda error rate metric
    const lambdaErrorMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // Lambda p95 latency metric
    const lambdaLatencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      statistic: 'p95',
      period: cdk.Duration.minutes(5),
    });

    // Alarm for Lambda errors
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: lambdaErrorMetric,
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Lambda error rate is too high',
    });

    lambdaErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Alarm for Lambda p95 latency
    const lambdaLatencyAlarm = new cloudwatch.Alarm(this, 'LambdaLatencyAlarm', {
      metric: lambdaLatencyMetric,
      threshold: 3000, // 3 seconds
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Lambda p95 latency is too high',
    });

    lambdaLatencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Account-wide Lambda Concurrency Alarm
    const concurrencyLimit = 1000; // Default AWS limit (update after requesting increase)
    const concurrencyThreshold = concurrencyLimit * 0.7; // Alert at 70%
    
    const concurrencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'ConcurrentExecutions',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    });

    const concurrencyAlarm = new cloudwatch.Alarm(this, 'LambdaConcurrencyAlarm', {
      metric: concurrencyMetric,
      threshold: concurrencyThreshold,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: `Lambda concurrent executions > ${concurrencyThreshold} (70% of ${concurrencyLimit} limit)`,
    });

    concurrencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Account-wide Lambda Throttle Alarm
    const throttleMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Throttles',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const accountThrottleAlarm = new cloudwatch.Alarm(this, 'LambdaAccountThrottleAlarm', {
      metric: throttleMetric,
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Lambda functions throttled due to account concurrency limit',
    });

    accountThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Add widgets to dashboard
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Concurrent Executions (Account-wide)',
        left: [concurrencyMetric],
        width: 24,
        height: 6,
        leftYAxis: {
          min: 0,
          max: concurrencyLimit,
          label: 'Concurrent Executions',
        },
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Requests',
        left: [apiRequestMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Errors',
        left: [
          api4xxMetric.with({ color: cloudwatch.Color.ORANGE, label: '4XX Errors' }),
          api5xxMetric.with({ color: cloudwatch.Color.RED, label: '5XX Errors' }),
        ],
        width: 12,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [lambdaErrorMetric.with({ color: cloudwatch.Color.RED })],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (p95)',
        left: [lambdaLatencyMetric],
        width: 12,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Throttles (Account-wide)',
        left: [throttleMetric.with({ color: cloudwatch.Color.ORANGE })],
        width: 24,
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'ARN of SNS topic for alarms',
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });
  }
}
