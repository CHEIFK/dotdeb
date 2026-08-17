# DOT DEB — 10X EDITION

A major upgrade of the reference-inspired game homepage.

## New

- Category filtering
- Search
- Shuffle
- Favorites stored in localStorage
- Project quick-preview modal
- Dark/light appearance toggle
- Better project descriptions
- Rich card badges
- Improved hover motion
- Staggered entrance animation
- Mobile-specific controls
- Responsive grid
- Accessible buttons and focus states
- Lightweight CSS-generated artwork
- No framework
- No build step
- No external image assets

## Adding a project

Add an object to `projects` in `script.js`:

```js
{
  title: "My Game",
  desc: "Short description.",
  cat: "Game",
  className: "my-game",
  font: "bold",
  fg: "#111",
  href: "games/my-game/index.html"
}
```

Then optionally create artwork using:

```css
.my-game .art { ... }
.my-game .art:before { ... }
.my-game .art:after { ... }
```
