# YTStudio

A creative suite that runs on your own computer, in the browser or as a desktop app: a video editor modelled on
Premiere, a DAW modelled on FL Studio, and a photo editor modelled on Photoshop, with an audio-reactive visualizer
built in. Every project is a file of its own, and an AI assistant (your own Claude Code or Codex) can do anything you can.

![Home](docs/readme/home.jpg)
*Home: every project, whatever the app, with live previews.*

![Video editor](docs/readme/video.jpg)
*The video editor: timeline, Program monitor and keyframed effect controls, Premiere's way.*

![Visualizer](docs/readme/visualizer.jpg)
*The visualizer: a 3D scene driven by a song's stems, each one a signal lane on the timeline.*

![Playlist](docs/readme/music-playlist.jpg)
*The music suite: FL Studio's playlist, patterns and automation.*

![Piano roll](docs/readme/music-piano-roll.jpg)
*The piano roll.*

![Mixer](docs/readme/music-mixer.jpg)
*The mixer, with YT-L, the built-in limiter, open on the master.*

![Photo editor](docs/readme/photo.jpg)
*The photo editor: layers and non-destructive filters, on WebGPU.*

![Filter Gallery](docs/readme/photo-filters.jpg)
*The Filter Gallery: a look previewed on the layer before it's applied.*

![Now Playing](docs/readme/now-playing.jpg)
*Now Playing: a full-window visualizer of whatever Spotify is playing, listening to the computer's sound live.*

```bash
pnpm install && pnpm dev   # http://localhost:5310 (needs ffmpeg)
```

The user guide is in [docs/guide.md](docs/guide.md).
