import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface CostMonitoringStackProps extends cdk.StackProps {
	stage: string;
	alertEmail?: string;
	monthlyBudget?: number; // in USD
}

/**
 * Cost Monitoring Stack
 *
 * Creates AWS Budgets to monitor and alert on spending.
 * First 2 budgets are FREE, additional budgets cost $0.02/day.
 */
export class CostMonitoringStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: CostMonitoringStackProps) {
		super(scope, id, props);

		if (!process.env.PROJECT_NAME) {
			throw new Error("PROJECT_NAME environment variable is required");
		}
		if (!props.monthlyBudget) {
			throw new Error("monthlyBudget prop is required for CostMonitoringStack");
		}
		const projectName = process.env.PROJECT_NAME;
		const monthlyBudget = props.monthlyBudget;

		// SNS topic for budget alerts
		const budgetAlertTopic = new sns.Topic(this, "BudgetAlertTopic", {
			topicName: `${projectName}-${props.stage}-budget-alerts`,
			displayName: `${projectName} ${props.stage} Budget Alerts`,
		});

		// Subscribe email if provided
		if (props.alertEmail) {
			budgetAlertTopic.addSubscription(
				new snsSubscriptions.EmailSubscription(props.alertEmail),
			);
		}

		// Monthly budget with alerts at 50%, 80%, 100%
		new budgets.CfnBudget(this, "MonthlyBudget", {
			budget: {
				budgetName: `${projectName}-${props.stage}-monthly-budget`,
				budgetType: "COST",
				timeUnit: "MONTHLY",
				budgetLimit: {
					amount: monthlyBudget,
					unit: "USD",
				},
			},
			notificationsWithSubscribers: [
				{
					notification: {
						notificationType: "ACTUAL",
						comparisonOperator: "GREATER_THAN",
						threshold: 50,
						thresholdType: "PERCENTAGE",
					},
					subscribers: [
						{
							subscriptionType: "SNS",
							address: budgetAlertTopic.topicArn,
						},
					],
				},
				{
					notification: {
						notificationType: "ACTUAL",
						comparisonOperator: "GREATER_THAN",
						threshold: 80,
						thresholdType: "PERCENTAGE",
					},
					subscribers: [
						{
							subscriptionType: "SNS",
							address: budgetAlertTopic.topicArn,
						},
					],
				},
				{
					notification: {
						notificationType: "ACTUAL",
						comparisonOperator: "GREATER_THAN",
						threshold: 100,
						thresholdType: "PERCENTAGE",
					},
					subscribers: [
						{
							subscriptionType: "SNS",
							address: budgetAlertTopic.topicArn,
						},
					],
				},
				{
					notification: {
						notificationType: "FORECASTED",
						comparisonOperator: "GREATER_THAN",
						threshold: 100,
						thresholdType: "PERCENTAGE",
					},
					subscribers: [
						{
							subscriptionType: "SNS",
							address: budgetAlertTopic.topicArn,
						},
					],
				},
			],
		});

		// Daily budget (optional - useful for detecting runaway costs)
		new budgets.CfnBudget(this, "DailyBudget", {
			budget: {
				budgetName: `${projectName}-${props.stage}-daily-budget`,
				budgetType: "COST",
				timeUnit: "DAILY",
				budgetLimit: {
					amount: monthlyBudget / 30, // Daily limit = monthly / 30
					unit: "USD",
				},
			},
			notificationsWithSubscribers: [
				{
					notification: {
						notificationType: "ACTUAL",
						comparisonOperator: "GREATER_THAN",
						threshold: 100,
						thresholdType: "PERCENTAGE",
					},
					subscribers: [
						{
							subscriptionType: "SNS",
							address: budgetAlertTopic.topicArn,
						},
					],
				},
			],
		});

		// Outputs
		new cdk.CfnOutput(this, "BudgetAlertTopicArn", {
			value: budgetAlertTopic.topicArn,
			description: "SNS topic for budget alerts",
		});

		new cdk.CfnOutput(this, "MonthlyBudgetAmount", {
			value: `$${monthlyBudget}`,
			description: "Monthly budget limit",
		});
	}
}
