import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface PublicAssetsStackProps extends cdk.StackProps {
  stage: string;
  domainName: string; 
  hostedZoneId?: string; // Route53 hosted zone ID
  assetsCertArn?: string; // Existing ACM certificate ARN for CloudFront
}

export class PublicAssetsStack extends cdk.Stack {
  public readonly bucket: s3.IBucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly assetsDomain: string;

  constructor(scope: Construct, id: string, props: PublicAssetsStackProps) {
    super(scope, id, props);

    const { stage, domainName, hostedZoneId, assetsCertArn } = props;
    if (!process.env.PROJECT_NAME) {
      throw new Error('PROJECT_NAME environment variable is required');
    }
    const projectName = process.env.PROJECT_NAME;
    
    // Create bucket name for public assets
    const bucketName = stage === 'production' 
      ? `${projectName}-public-assets` 
      : `${projectName}-public-assets-staging`;

    // Create subdomain for public assets
    this.assetsDomain = stage === 'production' 
      ? `assets.${domainName}`
      : `assets-staging.${domainName}`;

    // Create S3 bucket for public assets
    this.bucket = new s3.Bucket(this, 'PublicAssetsBucket', {
      bucketName,
      versioned: false,
      publicReadAccess: true, // This bucket is for public assets
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ['*'], // Public assets can be accessed from anywhere
          exposedHeaders: ['ETag', 'x-amz-server-side-encryption', 'x-amz-request-id'],
          maxAge: 3600, // 1 hour cache for CORS preflight
        },
      ],
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      removalPolicy: stage === 'production' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'production',
    });

    // Add bucket policy for public read access
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'PublicReadGetObject',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [`${this.bucket.bucketArn}/*`],
      })
    );

    // Get hosted zone and certificate
    let hostedZone: route53.IHostedZone | undefined;
    let certificate: acm.ICertificate | undefined;
    
    if (assetsCertArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'AssetsCloudFrontCertificate', assetsCertArn);
    } else if (hostedZoneId) {
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'AssetsHostedZone', {
        hostedZoneId,
        zoneName: domainName,
      });

      // Create ACM certificate for CloudFront (must be in us-east-1)
      certificate = new acm.Certificate(this, 'AssetsCloudFrontCertificate', {
        domainName: this.assetsDomain,
        certificateName: `${this.assetsDomain}-cert`,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    // Create CloudFront distribution for public assets
    const distributionConfig: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: new cloudfront.CachePolicy(this, 'PublicAssetsCachePolicy', {
          cachePolicyName: `${projectName}-${stage}-public-assets-cache-policy`,
          comment: 'Cache policy for public assets with long TTL',
          defaultTtl: cdk.Duration.hours(24), // 24 hours default
          maxTtl: cdk.Duration.days(365), // 1 year max
          minTtl: cdk.Duration.seconds(0),
          headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
            'Access-Control-Request-Headers',
            'Access-Control-Request-Method',
            'Origin'
          ),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.allowList(
            'v', // version parameter for cache busting
            'w', // width for future image resizing
            'h', // height for future image resizing
            'q', // quality for future image optimization
          ),
        }),
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, 'PublicAssetsResponseHeaders', {
          responseHeadersPolicyName: `${projectName}-${stage}-public-assets-headers`,
          comment: 'Response headers for public assets',
          corsBehavior: {
            accessControlAllowCredentials: false,
            accessControlAllowHeaders: ['*'],
            accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
            accessControlAllowOrigins: ['*'],
            accessControlMaxAge: cdk.Duration.hours(1),
            originOverride: false,
          },
          customHeadersBehavior: {
            customHeaders: [
              {
                header: 'Cache-Control',
                value: 'public, max-age=31536000, immutable', // 1 year cache for static assets
                override: false,
              },
            ],
          },
        }),
        compress: true,
      },
      // Additional behaviors for different asset types
      additionalBehaviors: {
        // Email templates and HTML assets - shorter cache
        '/emails/*': {
          origin: new origins.S3Origin(this.bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: new cloudfront.CachePolicy(this, 'EmailTemplatesCachePolicy', {
            cachePolicyName: `${projectName}-${stage}-email-templates-cache-policy`,
            defaultTtl: cdk.Duration.hours(1), // 1 hour for email templates
            maxTtl: cdk.Duration.days(7), // 1 week max
            minTtl: cdk.Duration.seconds(0),
          }),
          compress: true,
        },
        // Static assets like CSS, JS - long cache with versioning
        '/static/*': {
          origin: new origins.S3Origin(this.bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
      domainNames: certificate ? [this.assetsDomain] : undefined,
      certificate,
      comment: `${projectName} ${stage} public assets CDN distribution`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultRootObject: 'index.html', // For serving websites from subdirectories
    };

    this.distribution = new cloudfront.Distribution(this, 'PublicAssetsDistribution', distributionConfig);

    // Create Route53 record if hosted zone is provided
    if (hostedZone) {
      new route53.ARecord(this, 'AssetsRecord', {
        zone: hostedZone,
        recordName: this.assetsDomain,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // Create folder structure in the bucket for organization
    const folderStructure = [
      'emails/templates/',
      'emails/images/',
      'website/images/',
      'website/css/',
      'website/js/',
      'static/logos/',
      'static/icons/',
      'static/fonts/',
      'marketing/images/',
      'marketing/videos/',
    ];

    // Create placeholder objects to establish folder structure
    folderStructure.forEach((folder, index) => {
      new s3deploy.BucketDeployment(this, `FolderStructure${index}`, {
        sources: [s3deploy.Source.data(`${folder}.gitkeep`, '')],
        destinationBucket: this.bucket,
        destinationKeyPrefix: folder,
        prune: false,
      });
    });

    // Output values
    new cdk.CfnOutput(this, 'PublicAssetsBucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket name for public assets',
      exportName: `${projectName}-${stage}-PublicAssetsBucketName`,
    });

    new cdk.CfnOutput(this, 'PublicAssetsDistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain for public assets',
      exportName: `${projectName}-${stage}-PublicAssetsDistributionDomain`,
    });

    new cdk.CfnOutput(this, 'PublicAssetsCustomDomain', {
      value: this.assetsDomain,
      description: 'Custom domain for public assets CDN',
      exportName: `${projectName}-${stage}-PublicAssetsCustomDomain`,
    });

    new cdk.CfnOutput(this, 'PublicAssetsDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidation',
      exportName: `${projectName}-${stage}-PublicAssetsDistributionId`,
    });

    // Output example URLs for different asset types
    new cdk.CfnOutput(this, 'ExampleAssetUrls', {
      value: JSON.stringify({
        emailTemplate: `https://${this.assetsDomain}/emails/templates/welcome.html`,
        logo: `https://${this.assetsDomain}/static/logos/logo.png`,
        css: `https://${this.assetsDomain}/static/css/styles.css`,
        marketingImage: `https://${this.assetsDomain}/marketing/images/hero-banner.jpg`,
      }),
      description: 'Example URLs for different asset types',
    });
  }
}
