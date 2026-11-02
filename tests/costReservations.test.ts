import { describe, expect, it } from "vitest";
import {
  markReservationFinalized,
  markReservationReleased,
  markReservationUncertain,
  type CostReservationState,
} from "@/lib/costReservations";

const reserved: CostReservationState = {
  state: "reserved",
  reservedAt: "2026-08-26T00:00:00.000Z",
  expiresAt: "2026-08-26T00:15:00.000Z",
};

describe("cost reservation lifecycle", () => {
  it("finalizes a live reservation once", () => {
    expect(markReservationFinalized(reserved, "2026-08-26T00:01:00.000Z")).toEqual({
      ...reserved,
      state: "finalized",
      finalizedAt: "2026-08-26T00:01:00.000Z",
    });
    expect(() => markReservationFinalized({ ...reserved, state: "released" }, "2026-08-26T00:01:00.000Z"))
      .toThrow("cost reservation is released");
  });

  it("releases only a reservation known to have made no provider call", () => {
    expect(markReservationReleased(reserved, "2026-08-26T00:01:00.000Z")).toMatchObject({
      state: "released",
      releasedAt: "2026-08-26T00:01:00.000Z",
    });
  });

  it("quarantines an ambiguous or expired reservation instead of releasing it", () => {
    expect(markReservationUncertain(reserved, "provider outcome unknown", "2026-08-26T00:16:00.000Z"))
      .toMatchObject({
        state: "uncertain",
        uncertainReason: "provider outcome unknown",
        uncertainAt: "2026-08-26T00:16:00.000Z",
      });
  });
});
