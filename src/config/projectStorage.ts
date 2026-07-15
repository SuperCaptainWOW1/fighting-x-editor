export type ProjectStorageMode = "local" | "remote";

const normalizeBaseUrl = (value: string | undefined) =>
  value?.trim().replace(/\/+$/, "") ?? "";

const mode = import.meta.env.VITE_PROJECT_STORAGE_MODE === "remote"
  ? "remote"
  : "local";
const remoteProfilesBaseUrl = normalizeBaseUrl(
  import.meta.env.VITE_FRAMEDATA_CDN_BASE_URL,
);

export const projectStorageConfig = {
  mode,
  remote: {
    profilesUrl: remoteProfilesBaseUrl && /^https?:\/\//.test(remoteProfilesBaseUrl)
      ? `${remoteProfilesBaseUrl}/`
      : remoteProfilesBaseUrl,
    saveUrl: import.meta.env.VITE_FRAMEDATA_SAVE_URL?.trim() ?? "",
    slug: import.meta.env.VITE_FRAMEDATA_PROFILE_SLUG?.trim() || "fighting-editor",
    credentials: import.meta.env.VITE_FRAMEDATA_REQUEST_CREDENTIALS === "include"
      ? "include"
      : "omit",
  },
  assets: {
    characterModelUrl:
      import.meta.env.VITE_CHARACTER_MODEL_URL?.trim() || "/models/character_test.glb",
    dracoDecoderPath:
      import.meta.env.VITE_DRACO_DECODER_PATH?.trim() || "/draco/",
  },
} as const;
