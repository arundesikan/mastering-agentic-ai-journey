"""
Step 4: Generate a cited answer from retrieved chunks. Refuses to answer
when nothing relevant was retrieved, instead of hallucinating.
"""
import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from retrieve import get_hybrid_retriever

load_dotenv()

SYSTEM_PROMPT = """You are a policy Q&A assistant. Answer the user's question
using ONLY the excerpts below. Every claim must cite the source document,
section, and page number exactly as they appear in the brackets before each
excerpt, e.g. "(Security Control Standards Catalog v2.2.pdf, RA-02: Security
Categorization, p.142)". If an excerpt has no section label, cite just the
document and page number.

If the excerpts do not contain enough information to answer confidently,
say: "I could not find this in the policy documents." Do not guess or use
outside knowledge.

Excerpts:
{context}
"""

llm = ChatOpenAI(
    model=os.getenv("CHAT_MODEL", "gpt-4o-mini"),
    base_url=os.getenv("OPENAI_BASE_URL"),
    temperature=0,
)

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    ("human", "{question}"),
])


def format_context(docs):
    parts = []
    for d in docs:
        src = d.metadata.get("source", "unknown")
        page = d.metadata.get("display_page", d.metadata.get("page", "?"))
        section = d.metadata.get("section", "")
        label = f"[{src}, {section}, p.{page}]" if section else f"[{src}, p.{page}]"
        parts.append(f"{label}\n{d.page_content}")
    return "\n\n".join(parts)


def answer(question: str, k: int = 5):
    retriever = get_hybrid_retriever(k=k)
    docs = retriever.invoke(question)
    context = format_context(docs)
    chain = prompt | llm
    response = chain.invoke({"context": context, "question": question})
    return response.content, docs


if __name__ == "__main__":
    q = "What is the policy on data classification?"
    ans, sources = answer(q)
    print("Q:", q)
    print("\nA:", ans)
