// Whether the server checks papers and accepts reports. Until the moderation
// service is configured and deployed, the app must not tell visitors their
// text goes to OpenAI or offer a report that has nowhere to go; the server
// commit that adds the checks turns this on.
export const SAFETY_CHECKS = false;
