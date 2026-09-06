"""
Step 2: Chunk documents by section, embed them, and store them in a local
in-memory vector store (saved to a JSON file on disk). Run:
python chunk_and_embed.py

Note: this uses LangChain's InMemoryVectorStore rather than Chroma. Chroma
needs a compiled C++ extension (hnswlib) that requires the Microsoft C++
Build Tools on Windows -- a multi-GB install just to get a small local
vector store. InMemoryVectorStore is pure Python, needs nothing extra to
install, and for a corpus this size (a few hundred chunks) the search
speed difference is not noticeable.
"""
import os
from dotenv import load_dotenv
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_core.vectorstores import InMemoryVectorStore

from ingest import load_all_pdfs

load_dotenv()

PERSIST_PATH = os.path.join(os.path.dirname(__file__), "..", "vectorstore.json")

# Semantic-ish chunking: split on section headers first where possible,
# fall back to size-based splitting so no chunk crosses ~800 tokens.
SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=1500,       # characters, roughly 350-450 tokens
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""],
)


def build_vectorstore():
    docs = load_all_pdfs()
    if not docs:
        return None

    chunks = SPLITTER.split_documents(docs)
    print(f"Split {len(docs)} pages into {len(chunks)} chunks")

    embeddings = OpenAIEmbeddings(
        model=os.getenv("EMBED_MODEL", "text-embedding-3-small"),
        base_url=os.getenv("OPENAI_BASE_URL"),
    )

    vectorstore = InMemoryVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
    )
    vectorstore.dump(PERSIST_PATH)
    print(f"Vector store built and persisted to {PERSIST_PATH}")
    return vectorstore


if __name__ == "__main__":
    build_vectorstore()
