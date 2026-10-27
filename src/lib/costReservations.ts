export type CostReservationStatus = "reserved" | "finalized" | "released" | "uncertain";

export interface CostReservationState {
  state: CostReservationStatus;
  reservedAt: string;
  expiresAt: string;
  finalizedAt?: string;
  releasedAt?: string;
  uncertainAt?: string;
  uncertainReason?: string;
}

function requireReserved(reservation: CostReservationState): void {
  if (reservation.state !== "reserved") {
    throw new Error(`cost reservation is ${reservation.state}`);
  }
}

export function markReservationFinalized(
  reservation: CostReservationState,
  finalizedAt: string,
): CostReservationState {
  requireReserved(reservation);
  return { ...reservation, state: "finalized", finalizedAt };
}

export function markReservationReleased(
  reservation: CostReservationState,
  releasedAt: string,
): CostReservationState {
  requireReserved(reservation);
  return { ...reservation, state: "released", releasedAt };
}

export function markReservationUncertain(
  reservation: CostReservationState,
  uncertainReason: string,
  uncertainAt: string,
): CostReservationState {
  requireReserved(reservation);
  if (!uncertainReason.trim()) throw new Error("uncertain reservation requires a reason");
  return { ...reservation, state: "uncertain", uncertainReason, uncertainAt };
}
