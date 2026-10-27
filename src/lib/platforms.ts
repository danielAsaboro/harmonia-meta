/**
 * Social platform registry — one definition per supported network.
 * Application credentials are deployment-wide; user connections are always
 * workspace-scoped OAuth records and are never inferred from environment state.
 */
export type PlatformCapability = "publish" | "verify" | "metrics";

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** PKCE S256 is mandatory for X; Google supports it. */
  usesPkce: boolean;
  /** Token endpoint auth style. */
  tokenAuth: "basic" | "body";
  /** Scope list joiner expected by the platform's authorize URL. */
  scopeSeparator: string;
  /** Provider-specific client identifier parameter; OAuth defaults to client_id. */
  clientIdParam?: string;
  extraAuthorizeParams?: Record<string, string>;
  /** Authorize-query parameter names mapped to server-side environment variables. */
  extraAuthorizeEnvParams?: Record<string, string>;
}

export interface PlatformDef {
  id: string;
  label: string;
  /** Env vars that must be set for this platform to be connectable. */
  requiredEnv: string[];
  capabilities: PlatformCapability[];
  productAvailability: "active" | "oauth_connectable" | "credential_groundwork";
  docsUrl: string;
  note: string;
  oauth: OAuthConfig;
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: "google-drive",
    label: "Google Drive brand library",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: [],
    productAvailability: "active",
    oauth: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      usesPkce: true,
      scopeSeparator: " ",
      tokenAuth: "body",
      extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    },
    docsUrl: "https://developers.google.com/drive/api/guides/about-auth",
    note: "Reads only operator-selected brand-library folders; jobs pin immutable snapshots.",
  },
  {
    id: "google-calendar",
    label: "Google Calendar",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: [],
    productAvailability: "active",
    oauth: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/calendar.app.created"],
      usesPkce: true,
      scopeSeparator: " ",
      tokenAuth: "body",
      extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    },
    docsUrl: "https://developers.google.com/workspace/calendar/api/auth",
    note: "Syncs scheduled content to a dedicated Harmonia calendar. It cannot access unrelated calendars or events.",
  },
  {
    id: "x",
    label: "X (Twitter)",
    requiredEnv: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    capabilities: ["publish", "verify", "metrics"],
    productAvailability: "active",
    oauth: {
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    usesPkce: true,
    scopeSeparator: " ",
    tokenAuth: "basic",
  },
    docsUrl: "https://developer.x.com/en/portal/dashboard",
    note: "Publishes via official X API v2. Posting requires a project with Read & Write access; metrics use public_metrics.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    requiredEnv: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    capabilities: [],
    productAvailability: "oauth_connectable",
    oauth: {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    usesPkce: false,
    scopeSeparator: ",",
    clientIdParam: "client_key",
    tokenAuth: "body",
  },
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    note: "Direct Post via Content Posting API requires an approved app + unaudited/posting permissions. AIC labels apply to AI-generated content.",
  },
  {
    id: "instagram",
    label: "Instagram",
    requiredEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_CONFIGURATION_ID"],
    capabilities: [],
    productAvailability: "oauth_connectable",
    oauth: {
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    usesPkce: false,
    scopeSeparator: ",",
    tokenAuth: "body",
    extraAuthorizeEnvParams: { config_id: "INSTAGRAM_CONFIGURATION_ID" },
  },
    docsUrl: "https://developers.facebook.com/docs/instagram-api/getting-started",
    note: "Reels/posts via Instagram Graph API — requires a Professional (Business/Creator) account linked to a Facebook Page.",
  },
  {
    id: "linkedin",
    label: "LinkedIn member",
    requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    capabilities: [],
    productAvailability: "oauth_connectable",
    oauth: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    usesPkce: false,
    scopeSeparator: " ",
    tokenAuth: "body",
  },
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/",
    note: "Posts via LinkedIn API (w_member_social or w_organization_social scopes). OAuth 2.0 three-legged flow.",
  },
  {
    id: "linkedin-organization",
    label: "LinkedIn company page",
    requiredEnv: ["LINKEDIN_ORGANIZATION_CLIENT_ID", "LINKEDIN_ORGANIZATION_CLIENT_SECRET"],
    capabilities: [],
    productAvailability: "oauth_connectable",
    oauth: {
      authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      scopes: ["rw_organization_admin", "w_organization_social", "r_organization_social"],
      usesPkce: false,
      scopeSeparator: " ",
      tokenAuth: "body",
    },
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/",
    note: "Uses a dedicated Community Management API app because LinkedIn requires that product to be the only product on the application.",
  },
  {
    id: "facebook",
    label: "Facebook Pages",
    requiredEnv: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    capabilities: [],
    productAvailability: "credential_groundwork",
    oauth: {
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    usesPkce: false,
    scopeSeparator: ",",
    tokenAuth: "body",
  },
    docsUrl: "https://developers.facebook.com/docs/pages-api",
    note: "Page posts via Pages API with pages_manage_posts permission and a Page access token.",
  },
  {
    id: "youtube",
    label: "YouTube",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: [],
    productAvailability: "oauth_connectable",
    oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    usesPkce: true,
    scopeSeparator: " ",
    tokenAuth: "basic",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
    docsUrl: "https://developers.google.com/youtube/v3/guides/auth/installed-apps",
    note: "Uploads via YouTube Data API v3 (youtube.upload scope). Also enriches source metadata.",
  },
];

export function platformStatus(def: PlatformDef): {
  status: "connected" | "connectable" | "credentials_needed";
  missingActive: string[];
  missingRequired: string[];
} {
  const has = (name: string) => Boolean(process.env[name]);
  const missingRequired = def.requiredEnv.filter((e) => !has(e));
  const missingActive: string[] = [];
  if (missingRequired.length === 0) {
    // App credentials exist; an OAuth handshake would mint the access token.
    return { status: "connectable", missingActive, missingRequired };
  }
  return { status: "credentials_needed", missingActive, missingRequired };
}
