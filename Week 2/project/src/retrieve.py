"""
Step 3: Hybrid retrieval (dense vector + BM25 keyword) with a simple
rerank pass. This is what makes the bot find exact terms (e.g. "Section
4.2", specific product names) that pure semantic search sometimes misses.
"""
import os
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_community.retrievers import BM25Retriever
from langchain.retrievers import EnsembleRetriever

from ingest import load_all_pdfs
from chunk_and_embed import SPLITTER, PERSIST_PATH, build_vectorstore

load_dotenv()


def get_hybrid_retriever(k: int = 5):
    embeddings = OpenAIEmbeddings(
        model=os.getenv("EMBED_MODEL", "text-embedding-3-small"),
        base_url=os.getenv("OPENAI_BASE_URL"),
    )
    if os.path.exists(PERSIST_PATH):
        vectorstore = InMemoryVectorStore.load(PERSIST_PATH, embeddings)
    else:
        print("No saved vector store found -- building it now (run chunk_and_embed.py "
              "first next time to skip this step).")
        vectorstore = build_vectorstore()
    dense_retriever = vectorstore.as_retriever(search_kwargs={"k": k})

    # BM25 needs the raw chunks in memory (cheap to rebuild each run).
    docs = load_all_pdfs()
    chunks = SPLITTER.split_documents(docs)
    bm25_retriever = BM25Retriever.from_documents(chunks)
    bm25_retriever.k = k

    hybrid = EnsembleRetriever(
        retrievers=[dense_retriever, bm25_retriever],
        weights=[0.6, 0.4],
    )
    return hybrid


if __name__ == "__main__":
    retriever = get_hybrid_retriever()
    results = retriever.invoke("What is the policy on data classification?")
    for i, r in enumerate(results, 1):
        page = r.metadata.get("display_page", r.metadata.get("page"))
        section = r.metadata.get("section", "")
        label = f"{r.metadata.get('source')}, {section}, p.{page}" if section else f"{r.metadata.get('source')}, p.{page}"
        print(f"\n--- Result {i} ({label}) ---")
        print(r.page_content[:300])
