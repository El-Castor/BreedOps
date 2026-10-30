export type StackProfile = {
  name: "canonical" | "release-check";
  projectId: string;
  apiPort: number;
  dbPort: number;
  dbContainer: string;
  backendFile: string;
  appPort: number;
  apiUrl: string;
  appOrigin: string;
  appPidFile: string;
  workdir?: string;
  portOffset?: number;
};

export const CANONICAL: StackProfile;
export const RELEASE_CHECK: StackProfile;
export function currentProfile(): StackProfile;
export function assertNotCanonicalIdentity(profile: StackProfile): void;
export function assertStatusMatchesProfile(
  status: { API_URL: string },
  profile: StackProfile,
): void;
