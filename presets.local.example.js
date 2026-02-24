// Copy this file to presets.local.js to override the default puzzle presets.
// presets.local.js is gitignored so your customizations won't be committed.
//
// Export a default array of preset objects. Each preset needs:
//   url: string        - Image or video URL (type is auto-detected from extension)
//   thumbnail?: string - Optional thumbnail URL (falls back to placeholder)
//
// URLs can be relative to the location of presets.local.js (the project root).

export default [
    {
        url: "https://example.com/my-image.jpg"
    }
    // {
    //     url: "https://example.com/my-video.mp4"
    // }
]
