## Troubleshooting

### "No history found for thread"

- Ensure the thread exists in LangGraph
- Check that `deploymentUrl` is correct
- Verify `langsmithApiKey` has access to the deployment

### Messages not loading on refresh

- Confirm `threadId` is being passed to `<CopilotKit>`
- Check browser console for hydration errors
- Enable `debug: true` to see detailed logs

### "URL mismatch detected" warning

This is expected when the runner detects and fixes serverless state contamination. The client is automatically replaced with the correct URL.