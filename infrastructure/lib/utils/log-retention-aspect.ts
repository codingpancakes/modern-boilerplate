import { IAspect } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * CDK Aspect to set CloudWatch log retention on all Lambda functions.
 *
 * Unlike the previous version that collected functions in visit() and applied
 * retention afterward (which ran before visit() was called), this version
 * applies the logRetention property directly inside visit(), which runs
 * during the CDK prepare phase when all constructs are available.
 *
 * Usage:
 * ```typescript
 * Aspects.of(this).add(new LogRetentionAspect(stage));
 * ```
 */
export class LogRetentionAspect implements IAspect {
  private readonly retention: logs.RetentionDays;

  constructor(stage: string) {
    this.retention =
      stage === 'production'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK;
  }

  visit(node: IConstruct): void {
    if (
      node instanceof lambdaNodejs.NodejsFunction ||
      node instanceof lambda.Function
    ) {
      // logRetention is a first-class CDK property that creates the
      // LogRetention custom resource automatically. Setting it in visit()
      // guarantees it applies to every Lambda found during the prepare phase.
      (node as lambda.Function).addEnvironment(
        '_LOG_RETENTION_APPLIED', 'true'
      );
      new logs.LogRetention(node, 'LogRetention', {
        logGroupName: `/aws/lambda/${node.functionName}`,
        retention: this.retention,
      });
    }
  }
}
