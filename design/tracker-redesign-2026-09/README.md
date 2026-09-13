# Academic Tracker UI redesign — Direction A "Command centre" (Sep 2026)

Design canvas (view, export PNG/PDF, edit): https://claude.ai/code/artifact/84745005-a7a0-471f-8ed6-0673861bf384

## What is here
- `*.dc.html` — one artboard per screen (static HTML + inline styles, 1440×900; `Mobile` is 390×844). Open any file in a browser to view it.
- `canvas.json` — page/board layout for the canvas and the sticky-note commentary.
- `build_screens.py`, `build_screens2.py` — generate the desktop screens from the shared shell in `Main.dc.html` (sidebar + header). `python3 build_screens2.py` regenerates all of them.
- `Editorial.dc.html`, `Cockpit.dc.html` — the two unchosen directions (B, C), kept for reference.

## Direction A in one paragraph
Keeps the existing tokens (DM Sans, greige ground, white cards, ink text, house colours for house chips only) and changes structure: the 24 flat sidebar links become groups (Teaching · Assessment · People · Schedule & setup), a ⌘K global search and session pill sit in the header, the branch switcher moves to the top of the sidebar, and the dashboard leads with today's coverage and a "Needs attention" queue instead of raw counts. Workflow pages (Examinations) collapse the sidebar to a 64px icon rail.

## Shell + patterns to reuse
- Sidebar 236px white, `#E9E8E0` border; active item `#E4EFE8` / `#2C4A38`; group labels 10.5px uppercase `#9C9B90`.
- Header 56px: search box 420px, session pill, bell, theme toggle.
- Page head = crumb · 24px/700 title · one-line purpose · actions right. Primary action = ink `#26251F` button, 10px radius.
- Filter row: 36px selects/chips; legend or status chips at the right end.
- Cards: white, `#E9E8E0` border, 14px radius; table header row on `#FAFAF7`, 10.5px uppercase `#75746B`.
- Heatmap cells 26–30px; semantic colours green `#3E8E5A` / gold `#A87E12` / crimson `#B5372A`; arrangement orange `#E07B00`.
- Right rail 300–360px for the thing being edited or the reason something is blocked.

All names, numbers and times on the boards are sample data.
