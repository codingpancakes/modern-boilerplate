/**
 * Unsubscribe Utilities
 *
 * Helper functions for checking unsubscribe status and managing global unsubscribes.
 * Ensures compliance with CAN-SPAM, GDPR, and other email regulations.
 */

import { and, eq, or } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";

const { contactChannels, contacts, contactSubscriptions, globalUnsubscribes } =
	schema;

type DbInstance = NeonHttpDatabase<typeof schema>;

export interface UnsubscribeCheckResult {
	canSend: boolean;
	reason?:
		| "GLOBAL_UNSUBSCRIBE"
		| "CONTACT_INACTIVE"
		| "CHANNEL_INACTIVE"
		| "TOPIC_UNSUBSCRIBED"
		| "CHANNEL_NOT_FOUND";
	details?: string;
}

export interface GlobalUnsubscribeInput {
	organizationId: string;
	email?: string;
	phone?: string;
	channelKind: string;
	reason?: string;
	source?: string;
	topicId?: string;
	userAgent?: string;
	ipAddress?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Check if a contact can receive a message on a specific channel and topic
 */
export async function canSendMessage(
	db: DbInstance,
	params: {
		contactId: string;
		organizationId: string;
		channelKind: string;
		topicId?: string;
	},
): Promise<UnsubscribeCheckResult> {
	const { contactId, organizationId, channelKind, topicId } = params;

	// 1. Get contact details
	const contact = await db.query.contacts.findFirst({
		where: eq(contacts.id, contactId),
	});

	if (!contact) {
		return {
			canSend: false,
			reason: "CONTACT_INACTIVE",
			details: "Contact not found",
		};
	}

	// 2. Check global unsubscribe (HIGHEST PRIORITY)
	const globalUnsub = await db.query.globalUnsubscribes.findFirst({
		where: and(
			eq(globalUnsubscribes.organizationId, organizationId),
			eq(globalUnsubscribes.channelKind, channelKind),
			or(
				contact.email ? eq(globalUnsubscribes.email, contact.email) : undefined,
				contact.phone ? eq(globalUnsubscribes.phone, contact.phone) : undefined,
			),
		),
	});

	if (globalUnsub) {
		return {
			canSend: false,
			reason: "GLOBAL_UNSUBSCRIBE",
			details: `Globally unsubscribed on ${globalUnsub.unsubscribedAt} - ${globalUnsub.reason || "No reason provided"}`,
		};
	}

	// 3. Check contact status
	if (
		contact.status === "UNSUBSCRIBED" ||
		contact.status === "DELETED" ||
		contact.status === "COMPLAINED"
	) {
		return {
			canSend: false,
			reason: "CONTACT_INACTIVE",
			details: `Contact status: ${contact.status}`,
		};
	}

	// 4. Check channel status
	const channel = await db.query.contactChannels.findFirst({
		where: and(
			eq(contactChannels.contactId, contactId),
			eq(contactChannels.channelKind, channelKind),
		),
	});

	if (!channel) {
		return {
			canSend: false,
			reason: "CHANNEL_NOT_FOUND",
			details: `No ${channelKind} channel found for contact`,
		};
	}

	if (channel.status !== "ACTIVE") {
		return {
			canSend: false,
			reason: "CHANNEL_INACTIVE",
			details: `Channel status: ${channel.status}`,
		};
	}

	// 5. Check topic subscription (if topic specified)
	if (topicId) {
		const subscription = await db.query.contactSubscriptions.findFirst({
			where: and(
				eq(contactSubscriptions.contactId, contactId),
				eq(contactSubscriptions.topicId, topicId),
				eq(contactSubscriptions.channelKind, channelKind),
			),
		});

		if (subscription?.status === "UNSUBSCRIBED") {
			return {
				canSend: false,
				reason: "TOPIC_UNSUBSCRIBED",
				details: `Unsubscribed from topic: ${topicId}`,
			};
		}
	}

	// All checks passed
	return { canSend: true };
}

/**
 * Add a global unsubscribe entry
 */
export async function addGlobalUnsubscribe(
	db: DbInstance,
	input: GlobalUnsubscribeInput,
): Promise<void> {
	if (!input.email && !input.phone) {
		throw new Error("Either email or phone must be provided");
	}

	await db.insert(globalUnsubscribes).values({
		organizationId: input.organizationId,
		email: input.email,
		phone: input.phone,
		channelKind: input.channelKind,
		reason: input.reason,
		source: input.source || "API",
		topicId: input.topicId,
		userAgent: input.userAgent,
		ipAddress: input.ipAddress,
		metadata: input.metadata,
	});
}

/**
 * Check if an email/phone is globally unsubscribed (fast lookup)
 */
export async function isGloballyUnsubscribed(
	db: DbInstance,
	params: {
		organizationId: string;
		email?: string;
		phone?: string;
		channelKind: string;
	},
): Promise<boolean> {
	const { organizationId, email, phone, channelKind } = params;

	if (!email && !phone) {
		return false;
	}

	const result = await db.query.globalUnsubscribes.findFirst({
		where: and(
			eq(globalUnsubscribes.organizationId, organizationId),
			eq(globalUnsubscribes.channelKind, channelKind),
			or(
				email ? eq(globalUnsubscribes.email, email) : undefined,
				phone ? eq(globalUnsubscribes.phone, phone) : undefined,
			),
		),
	});

	return !!result;
}

/**
 * Handle unsubscribe from a specific topic
 */
export async function unsubscribeFromTopic(
	db: DbInstance,
	params: {
		contactId: string;
		organizationId: string;
		orgUnitId: string;
		topicId: string;
		channelKind: string;
		source?: string;
		userAgent?: string;
		ipAddress?: string;
	},
): Promise<void> {
	const { contactId, organizationId, orgUnitId, topicId, channelKind, source } =
		params;

	// Update or insert subscription status
	await db
		.insert(contactSubscriptions)
		.values({
			contactId,
			organizationId,
			orgUnitId,
			topicId,
			channelKind,
			status: "UNSUBSCRIBED",
			source: source || "UNSUBSCRIBE_LINK",
		})
		.onConflictDoUpdate({
			target: [
				contactSubscriptions.contactId,
				contactSubscriptions.topicId,
				contactSubscriptions.channelKind,
			],
			set: {
				status: "UNSUBSCRIBED",
				source: source || "UNSUBSCRIBE_LINK",
			},
		});
}

/**
 * Handle global unsubscribe (unsubscribe from all messages)
 */
export async function unsubscribeGlobally(
	db: DbInstance,
	params: {
		contactId: string;
		organizationId: string;
		channelKind: string;
		reason?: string;
		source?: string;
		userAgent?: string;
		ipAddress?: string;
	},
): Promise<void> {
	const { contactId, organizationId, channelKind, reason, source } = params;

	// Get contact to retrieve email/phone
	const contact = await db.query.contacts.findFirst({
		where: eq(contacts.id, contactId),
	});

	if (!contact) {
		throw new Error("Contact not found");
	}

	// Add to global unsubscribe list
	await addGlobalUnsubscribe(db, {
		organizationId,
		email: contact.email || undefined,
		phone: contact.phone || undefined,
		channelKind,
		reason: reason || "User requested global unsubscribe",
		source: source || "UNSUBSCRIBE_LINK",
		userAgent: params.userAgent,
		ipAddress: params.ipAddress,
	});

	// Update contact status
	await db
		.update(contacts)
		.set({ status: "UNSUBSCRIBED" })
		.where(eq(contacts.id, contactId));
}

/**
 * Handle hard bounce - mark channel as bounced and optionally add to global unsubscribe
 */
export async function handleHardBounce(
	db: DbInstance,
	params: {
		contactId: string;
		organizationId: string;
		channelKind: string;
		address: string;
		addToGlobalUnsubscribe?: boolean;
	},
): Promise<void> {
	const {
		contactId,
		organizationId,
		channelKind,
		address,
		addToGlobalUnsubscribe = true,
	} = params;

	// Update channel status
	await db
		.update(contactChannels)
		.set({ status: "BOUNCED" })
		.where(
			and(
				eq(contactChannels.contactId, contactId),
				eq(contactChannels.channelKind, channelKind),
			),
		);

	// Optionally add to global unsubscribe
	if (addToGlobalUnsubscribe) {
		await addGlobalUnsubscribe(db, {
			organizationId,
			email: channelKind === "EMAIL" ? address : undefined,
			phone: channelKind === "SMS" ? address : undefined,
			channelKind,
			reason: "Hard bounce - invalid address",
			source: "BOUNCE",
		});
	}
}

/**
 * Handle spam complaint - immediately block all messages
 */
export async function handleSpamComplaint(
	db: DbInstance,
	params: {
		contactId: string;
		organizationId: string;
		channelKind: string;
		address: string;
	},
): Promise<void> {
	const { contactId, organizationId, channelKind, address } = params;

	// Add to global unsubscribe immediately
	await addGlobalUnsubscribe(db, {
		organizationId,
		email: channelKind === "EMAIL" ? address : undefined,
		phone: channelKind === "SMS" ? address : undefined,
		channelKind,
		reason: "Spam complaint reported",
		source: "COMPLAINT",
	});

	// Update contact status
	await db
		.update(contacts)
		.set({ status: "COMPLAINED" })
		.where(eq(contacts.id, contactId));
}
