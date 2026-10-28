import {
  claimConnectionTokenRefresh,
  completeConnectionTokenRefresh,
  markConnectionTokenRefreshUncertain,
  type ConnectionDoc,
} from "./firestore";
import { getValidConnection } from "./connectionRefresh";
import { getPlatform, refreshAccessToken } from "./oauth";

export async function validPlatformConnection(platform: string): Promise<ConnectionDoc> {
  return getValidConnection(platform, {
    claim: claimConnectionTokenRefresh,
    refresh: async (requestedPlatform, refreshToken) => {
      const definition = getPlatform(requestedPlatform);
      if (!definition) throw new Error(`unknown OAuth platform: ${requestedPlatform}`);
      return refreshAccessToken(definition, refreshToken);
    },
    complete: completeConnectionTokenRefresh,
    markUncertain: markConnectionTokenRefreshUncertain,
  });
}
