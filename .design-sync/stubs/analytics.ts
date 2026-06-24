// design-sync stub for @/lib/analytics. No-ops in the preview environment.
export const track = (..._args: unknown[]): void => {};
export const identifyUser = (..._args: unknown[]): void => {};
export const resetAnalytics = (): void => {};
export const getPostHogFlag = (..._args: unknown[]): undefined => undefined;
export const onPostHogFlagsLoaded = (_cb?: () => void): void => {};
export const bucketCents = (..._args: unknown[]): string => 'na';
