import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface WafStackProps extends cdk.StackProps {
  stage: string;
  apiGatewayArn?: string; // Optional: associate with specific API Gateway
}

/**
 * WAF Stack - Web Application Firewall
 * 
 * Protects API Gateway from common web exploits:
 * - SQL injection
 * - XSS attacks
 * - Rate limiting (per IP)
 * - Geographic restrictions (optional)
 * - Known bad inputs
 */
export class WafStack extends cdk.Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const projectName = process.env.PROJECT_NAME || 'postway';
    const rateLimit = props.stage === 'production' ? 2000 : 5000; // Requests per 5 minutes per IP

    // Create WAF Web ACL
    this.webAcl = new wafv2.CfnWebACL(this, 'WebACL', {
      name: `${projectName}-${props.stage}-waf`,
      scope: 'REGIONAL', // For API Gateway (use CLOUDFRONT for CloudFront distributions)
      defaultAction: { allow: {} },
      description: `WAF for ${projectName} ${props.stage} API`,
      
      rules: [
        // Rule 1: Rate limiting per IP
        {
          name: 'RateLimitRule',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: rateLimit,
              aggregateKeyType: 'IP',
            },
          },
          action: {
            block: {
              customResponse: {
                responseCode: 429,
                customResponseBodyKey: 'RateLimitExceeded',
              },
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },

        // Rule 2: AWS Managed Rules - Core Rule Set (CRS)
        // Protects against OWASP Top 10 vulnerabilities
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              excludedRules: [
                // Exclude rules that might cause false positives
                // Uncomment if needed:
                // { name: 'SizeRestrictions_BODY' },
                // { name: 'GenericRFI_BODY' },
              ],
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
          },
        },

        // Rule 3: AWS Managed Rules - Known Bad Inputs
        // Blocks requests with patterns known to be malicious
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
          },
        },

        // Rule 4: AWS Managed Rules - SQL Injection
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 4,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSet',
          },
        },

        // Rule 5: Block requests with suspicious user agents
        {
          name: 'BlockBadBots',
          priority: 5,
          statement: {
            orStatement: {
              statements: [
                {
                  byteMatchStatement: {
                    searchString: 'bot',
                    fieldToMatch: { singleHeader: { name: 'user-agent' } },
                    textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                    positionalConstraint: 'CONTAINS',
                  },
                },
                {
                  byteMatchStatement: {
                    searchString: 'crawler',
                    fieldToMatch: { singleHeader: { name: 'user-agent' } },
                    textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                    positionalConstraint: 'CONTAINS',
                  },
                },
                {
                  byteMatchStatement: {
                    searchString: 'scraper',
                    fieldToMatch: { singleHeader: { name: 'user-agent' } },
                    textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                    positionalConstraint: 'CONTAINS',
                  },
                },
              ],
            },
          },
          action: {
            block: {
              customResponse: {
                responseCode: 403,
                customResponseBodyKey: 'BotBlocked',
              },
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'BlockBadBots',
          },
        },

        // Rule 6: Geographic restrictions (optional - commented out by default)
        // Uncomment and configure if you want to restrict by country
        // {
        //   name: 'GeoBlockRule',
        //   priority: 6,
        //   statement: {
        //     geoMatchStatement: {
        //       countryCodes: ['CN', 'RU', 'KP'], // Block China, Russia, North Korea
        //     },
        //   },
        //   action: {
        //     block: {
        //       customResponse: {
        //         responseCode: 403,
        //         customResponseBodyKey: 'GeoBlocked',
        //       },
        //     },
        //   },
        //   visibilityConfig: {
        //     sampledRequestsEnabled: true,
        //     cloudWatchMetricsEnabled: true,
        //     metricName: 'GeoBlockRule',
        //   },
        // },
      ],

      // Custom response bodies
      customResponseBodies: {
        RateLimitExceeded: {
          contentType: 'APPLICATION_JSON',
          content: JSON.stringify({
            error: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
          }),
        },
        BotBlocked: {
          contentType: 'APPLICATION_JSON',
          content: JSON.stringify({
            error: 'forbidden',
            message: 'Access denied.',
          }),
        },
        GeoBlocked: {
          contentType: 'APPLICATION_JSON',
          content: JSON.stringify({
            error: 'forbidden',
            message: 'Access from your location is not permitted.',
          }),
        },
      },

      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${projectName}-${props.stage}-waf`,
      },
    });

    // Associate WAF with API Gateway if ARN is provided
    if (props.apiGatewayArn) {
      new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
        resourceArn: props.apiGatewayArn,
        webAclArn: this.webAcl.attrArn,
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'WebACLArn', {
      value: this.webAcl.attrArn,
      description: 'ARN of the WAF Web ACL',
      exportName: `${projectName}-${props.stage}-waf-arn`,
    });

    new cdk.CfnOutput(this, 'WebACLId', {
      value: this.webAcl.attrId,
      description: 'ID of the WAF Web ACL',
    });
  }
}
