// Saves the settings of the settings dialog; answers with what was saved
export default defineEventHandler(async (event) => saveSettings(await readBody(event)))
