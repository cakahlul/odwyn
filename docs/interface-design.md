# Odwyn conversation workspace

Research: [xAI’s Grok Bot design case study](https://x.ai/news/designing-grok-bot), reviewed October 20, 2026. The article describes a persistent bot roster, recognizable identity, state through motion, and optional computer access. Its external CSS assets returned 403 during visual research; this implementation follows its documented interaction model, not a claimed pixel match.

## Structure

- Persistent desktop agent roster with actual latest-message previews and working/attention states. Switching agents restores their existing conversation and draft. Live updates preserve roster focus.
- Separate transcript canvas, compact agent identity header, primary computer access, and one overflow menu. Workspace switching lives in the desktop rail and mobile menu; mobile Home keeps it in the header.
- Home is an inbox and work list, replacing the prior avatar-card dashboard. Mobile keeps labeled navigation and uses full-width sheets for conversations, agents, and tools.
- Original 3D avatars and navigation assets remain. Their motion communicates activity; hover, press, menu, sheet, and agent transitions are short and respect reduced motion.

## Shared components

`public/workspace.css` replaces the rejected redesign block. It defines the roster, shell, transcript, composer, forms, settings, appearance preview, tools, collections, agent management, search, approval/error states, browser, and Oddy panel. Linen and charcoal palettes use semantic tokens. Native disclosure triangles become plus/minus affordances while retaining keyboard behavior. Existing dock preference, themes, permissions, and room workflows remain available.

## Evidence

`test/conversation-workspace.test.js` checks stylesheet delivery, agent switching/drafts, live roster focus, keyboard menus, computer focus return, dialogs, and responsive layouts. Existing focused tests cover themes/contrast, mobile sheets, rooms, attachments, tutorial entry points, and workspace isolation. Screenshots are in `artifacts/conversation-workspace-*.png`.

Physical-device Safari and software-keyboard behavior require device testing; viewport emulation does not establish those results.

## Control-system cleanup

The former raised-control rules are removed from `style.css`. Foundation layout and specialized behavior sit in a lower CSS cascade layer; `workspace.css` owns component appearance so old selector specificity cannot reinstate the previous skin. Shared checkbox/radio/range/select styling, compact palette choices, room and approval surfaces, workflow nodes, and collections now use the same visual system. Native semantics, keyboard operation, reduced motion, forced-color controls, and 3D avatar rendering remain intact. Browser assertions guard against gradients and inset shadows returning to primary controls.
