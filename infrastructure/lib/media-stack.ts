import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface MediaStackProps extends cdk.StackProps {
  stage: string;
  domainName: string; 
  hostedZoneId?: string; // Route53 hosted zone ID
  imagesCertArn?: string; // Existing ACM certificate ARN for CloudFront
}

export class MediaStack extends cdk.Stack {
  public readonly bucket: s3.IBucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MediaStackProps) {
    super(scope, id, props);

    const { stage, domainName, hostedZoneId, imagesCertArn } = props;
    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;
    const bucketName = process.env.IMAGES_BUCKET || `${projectName}-images-depot-${stage}`;
    
    // Import existing bucket or create new one
    // For production, bucket already exists - import it
    // For other environments, create new bucket
    const bucketExists = stage === 'production';
    
    this.bucket = bucketExists
      ? s3.Bucket.fromBucketName(this, 'ImagesBucket', bucketName)
      : new s3.Bucket(this, 'ImagesBucket', {
        bucketName,
        versioned: false,
        publicReadAccess: false,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        cors: [
          {
            allowedHeaders: ['*'],
            allowedMethods: [
              s3.HttpMethods.GET,
              s3.HttpMethods.PUT,
              s3.HttpMethods.POST,
              s3.HttpMethods.DELETE,
              s3.HttpMethods.HEAD,
            ],
            // CORS origins from environment or defaults
            allowedOrigins: process.env.CORS_DOMAIN_PATTERNS
              ? process.env.CORS_DOMAIN_PATTERNS.split(',').map(d => `https://${d.trim()}`).concat([
                  'http://localhost:*',
                  'http://127.0.0.1:*'
                ])
              : [
                  'http://localhost:*',
                  'http://127.0.0.1:*',
                ],
            exposedHeaders: ['ETag', 'x-amz-server-side-encryption', 'x-amz-request-id'],
            maxAge: 3000,
          },
        ],
        lifecycleRules: [
          {
            id: 'delete-old-multipart-uploads',
            abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
            enabled: true,
          },
        ],
        // IMPORTANT: Retain bucket on stack deletion to prevent data loss
        removalPolicy: stage === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: stage !== 'production',
      });

    // Create subdomain for CDN
    const subdomain = stage === 'production' 
      ? `images.${domainName}`
      : `images-staging.${domainName}`;

    // Get hosted zone (if provided)
    let hostedZone: route53.IHostedZone | undefined;
    let certificate: acm.ICertificate | undefined;
    
    // Use existing certificate if provided, otherwise create new one
    if (imagesCertArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'CloudFrontCertificate', imagesCertArn);
    } else if (hostedZoneId) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId,
        zoneName: domainName,
      });

      // Create ACM certificate for CloudFront (must be in us-east-1)
      certificate = new acm.Certificate(this, 'CloudFrontCertificate', {
        domainName: subdomain,
        certificateName: `${subdomain}-cert`,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    // Note: Lambda@Edge for image resizing will be added in a future iteration
    // For now, we'll serve images directly from S3 via CloudFront

    // Create Origin Access Identity for CloudFront
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${bucketName}`,
    });

    // Grant CloudFront access to S3 bucket
    this.bucket.grantRead(oai);

    // Create CloudFront distribution
    const distributionConfig: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      domainNames: certificate ? [subdomain] : undefined,
      certificate,
      comment: `${projectName} ${stage} image CDN distribution`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    };

    this.distribution = new cloudfront.Distribution(this, 'ImageDistribution', distributionConfig);

    // Create Route53 record if hosted zone is provided
    if (hostedZone) {
      new route53.ARecord(this, 'CDNRecord', {
        zone: hostedZone,
        recordName: subdomain,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // Output values
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket name for images',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
    });

    if (certificate) {
      new cdk.CfnOutput(this, 'CustomDomain', {
        value: subdomain,
        description: 'Custom domain for image CDN',
      });
    }

  }

}
