// Copy this file to presets.local.js to override the default puzzle presets.
// presets.local.js is gitignored so your customizations won't be committed.
//
// Export a default array of preset objects. Each preset needs:
//   name: string       - Display name in the picker
//   url: string        - Image or video URL (type is auto-detected from extension)
//   thumbnail?: string - Optional thumbnail URL (falls back to placeholder)

export default [
    {
        name: "My Custom Puzzle",
        url: "https://example.com/my-image.jpg"
    }
    // {
    //     name: "My Video Puzzle",
    //     url: "https://example.com/my-video.mp4"
    // }
]
