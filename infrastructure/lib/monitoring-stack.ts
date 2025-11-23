import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  stage: string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const projectName = process.env.PROJECT_NAME || 'railbranch';

    // SNS topic for alarms
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${projectName}-${props.stage}-alarms`,
      displayName: `${projectName} ${props.stage} API Alarms`,
    });

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

    // Metric for API Gateway 5xx errors
    const api5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: `${projectName}-${props.stage}-api`,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // Alarm for API Gateway 5xx errors
    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      metric: api5xxMetric,
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API Gateway 5xx error rate is too high',
    });

    api5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

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

    // Add widgets to dashboard
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Errors',
        left: [api5xxMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Performance',
        left: [lambdaErrorMetric],
        right: [lambdaLatencyMetric],
        width: 12,
      })
    );

    // Output alarm topic ARN
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'ARN of SNS topic for alarms',
    });
  }
}
