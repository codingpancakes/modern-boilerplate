import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import { Construct } from 'constructs';

export interface CloudTrailStackProps extends cdk.StackProps {
  stage: string;
}

export class CloudTrailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CloudTrailStackProps) {
    super(scope, id, props);

    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;

    // S3 bucket for CloudTrail logs
    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `${projectName}-cloudtrail-logs-${props.stage}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: [
        {
          id: 'TransitionToGlacierAndDelete',
          enabled: true,
          // Move to Glacier after 30 days (cheaper storage)
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          // Delete logs after 1 year
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // CloudTrail - logs all AWS API calls
    const trail = new cloudtrail.Trail(this, 'CloudTrail', {
      trailName: `${projectName}-${props.stage}-trail`,
      bucket: trailBucket,
      
      // Multi-region trail (captures events from all regions)
      isMultiRegionTrail: true,
      
      // Include global services (IAM, CloudFront, etc.)
      includeGlobalServiceEvents: true,
      
      // Enable log file validation (detect tampering)
      enableFileValidation: true,
      
      // Don't send to CloudWatch Logs (saves cost, can enable later if needed)
      sendToCloudWatchLogs: false,
      
      // Management events only (API calls) - data events cost extra
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'CloudTrailBucketName', {
      value: trailBucket.bucketName,
      description: 'S3 bucket storing CloudTrail logs',
    });

    new cdk.CfnOutput(this, 'CloudTrailArn', {
      value: trail.trailArn,
      description: 'ARN of the CloudTrail trail',
    });
  }
}
