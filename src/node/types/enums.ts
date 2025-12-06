/**
 * Status enums for the booking system
 */

export enum AppointmentStatus {
	PENDING = "pending",
	CONFIRMED = "confirmed",
	COMPLETED = "completed",
	canceled = "canceled",
}

export enum SessionStatus {
	PROVISIONED = "provisioned",
	HELD = "held",
	NO_SHOW = "no_show",
	canceled = "canceled",
}

export enum AttendeeStatus {
	RESERVED = "reserved",
	CONFIRMED = "confirmed",
	canceled = "canceled",
}

// Helper functions to get enum values as arrays
export const getAppointmentStatusValues = (): string[] =>
	Object.values(AppointmentStatus);
export const getSessionStatusValues = (): string[] =>
	Object.values(SessionStatus);
export const getAttendeeStatusValues = (): string[] =>
	Object.values(AttendeeStatus);

// Type guards for runtime validation
export const isValidAppointmentStatus = (
	status: string,
): status is AppointmentStatus => {
	return Object.values(AppointmentStatus).includes(status as AppointmentStatus);
};

export const isValidSessionStatus = (
	status: string,
): status is SessionStatus => {
	return Object.values(SessionStatus).includes(status as SessionStatus);
};

export const isValidAttendeeStatus = (
	status: string,
): status is AttendeeStatus => {
	return Object.values(AttendeeStatus).includes(status as AttendeeStatus);
};
