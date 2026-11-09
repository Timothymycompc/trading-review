Tim's next question, about the Solana Pulse website itself (code in /root/pulse-site/src, pages in src/pages,
the toolbox in src/pages/ToolboxPage.tsx and the components it uses; the live site is
https://solana-pulse-gateway-1021990235790.us-central1.run.app).

Tim: "There's a lot of information there and it all seems very crowded. Rework the toolbox to be simpler, and still
allow people to input their own data or use preloaded data to call the tool."

Please read the home page, the toolbox page and the tool doc pages, then tell me:
1. What a first-time visitor (a developer who arrived from a search or a PR) sees first, and what's crowding it.
2. A simpler structure for the whole site: which pages to keep, merge or drop, and what goes on the home page above
   the fold. Remember Gemini's earlier point: lead with check_tx / tx_matches and the proof.
3. A concrete design for a simpler toolbox: one screen per tool or one shared screen? How a visitor picks a tool, puts
   in their own input OR taps a ready example, runs it, and reads the answer. What to hide behind "more".
   It must keep: the free calls, real data with sources, "unknown" instead of guessing.
4. Anything on the site that's wrong, out of date, or that a reviewer would trip over.

Concrete and short (under 500 words). I'll build what we agree on.
