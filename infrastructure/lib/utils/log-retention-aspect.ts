import { IAspect } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * CDK Aspect to add CloudWatch log retention to all Lambda functions in a stack.
 * 
 * This aspect:
 * 1. Finds all Lambda functions in the stack
 * 2. Sets appropriate log retention based on stage (production: 1 month, staging: 1 week)
 * 3. Serializes LogRetention creation to avoid AWS API rate limits
 * 
 * Usage:
 * ```typescript
 * const logRetentionAspect = new LogRetentionAspect(stage);
 * Aspects.of(this).add(logRetentionAspect);
 * logRetentionAspect.applyLogRetention(this);
 * ```
 */
export class LogRetentionAspect implements IAspect {
  private lambdaFunctions: lambda.Function[] = [];
  private stage: string;

  constructor(stage: string) {
    this.stage = stage;
  }

  /**
   * Visit each construct in the stack and collect Lambda functions
   */
  visit(node: IConstruct): void {
    if (
      node instanceof lambdaNodejs.NodejsFunction ||
      node instanceof lambda.Function
    ) {
      this.lambdaFunctions.push(node);
    }
  }

  /**
   * Apply log retention to all collected Lambda functions.
   * Called after all constructs are visited.
   */
  public applyLogRetention(scope: Construct): void {
    // Determine retention based on environment
    const retention =
      this.stage === 'production'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK; // staging

    this.lambdaFunctions.forEach((lambdaFunction, index) => {
      const logRetention = new logs.LogRetention(
        scope,
        `${lambdaFunction.node.id}LogRetention`,
        {
          logGroupName: `/aws/lambda/${lambdaFunction.functionName}`,
          retention: retention,
        }
      );

      // Add dependencies to serialize LogRetention creation (avoid rate limits)
      if (index > 0) {
        const previousRetention = scope.node.findChild(
          `${this.lambdaFunctions[index - 1].node.id}LogRetention`
        );
        if (previousRetention) {
          logRetention.node.addDependency(previousRetention);
        }
      }
    });
  }
}
