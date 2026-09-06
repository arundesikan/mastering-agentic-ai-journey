# Week 2 Project — Enterprise Policy Q&A Bot

See `framework.txt` for the scoping (one-liner + framework fields).

## Setup
1. `python -m venv venv && source venv/bin/activate` (Mac/Linux) or `venv\Scripts\activate` (Windows)
2. `pip install -r requirements.txt`
3. `cp .env.example .env` and fill in your real API key
4. Drop 3-5 policy PDFs into `data/` (e.g. Texas DIR statewide policy manuals,
   or any public government policy PDF you prefer)

## Run, in order
1. `cd src && python ingest.py` — sanity check the PDFs load and page counts look right
2. `python chunk_and_embed.py` — builds the local vector store (`../chroma_db/`)
3. `python retrieve.py` — sanity check retrieval on one test question
4. `python generate.py` — sanity check one full answer with citations
5. `python eval.py` — runs all 15 eval questions, writes `../eval_report.md`
6. `streamlit run app.py` — the actual chat UI for your demo video

## Deliverables checklist (Week 2)
- [ ] `eval_report.md` filled in with your own notes on retrieval quality
- [ ] Project doc (Google Doc): overview, corpus used, prompts, iterations, learnings
- [ ] 5-min demo video walking through the app live
- [ ] Code + eval report pushed to GitHub
- [ ] Submit at https://forms.gle/1EYiudaGDfp2eY9f8 (NOT on Maven)
