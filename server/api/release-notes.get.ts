// Release notes of the running version, shown once after an update (see server/utils/release-notes.ts).
export default defineEventHandler(async () => {
  const { repository, version } = useRuntimeConfig().public
  return { html: await releaseNotes(repository, version) }
})
