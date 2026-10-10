// The app under test runs with MODERATION_PROVIDER=fixture (CI passes it to
// the container; start a local server with it too). That provider answers by
// marker strings in the text instead of calling OpenAI, so these specs can
// drive every outcome deterministically. Text without a marker is allowed.
// The server refuses fixture mode on Fly, so none of this applies there.
export { FIXTURE } from "../server/moderation.ts";
