import re

def sanitize_agent_content(content: str, agent_name: str) -> str:
    """
    Strips 'Name:' prefixes and surrounding quotes from the LLM output.
    Used by both the agent nodes and the chat bridge for safe persistence.
    """
    sanitized = content.strip()

    # 1. Strip dynamic name prefixes (e.g. 'Muse: ', 'Historian — ', 'Historian: ')
    # Case insensitive, matching at the start of the string or inside a leading quote.
    prefix_patterns = [
        rf"^\s*[\"']?{re.escape(agent_name)}\s*[:\-—]\s*[\"']?",
        r"^\s*[\"']?Agent\s*[:\-—]\s*[\"']?",
        r"^\s*[\"']?Response\s*[:\-—]\s*[\"']?",
        r"^\s*[\"']?Assistant\s*[:\-—]\s*[\"']?",
        r"^\s*[\"']?AI\s*[:\-—]\s*[\"']?",
    ]

    for pattern in prefix_patterns:
        sanitized = re.sub(pattern, "", sanitized, flags=re.IGNORECASE).strip()

    # 2. Strip surrounding bulk quotes if the agent wrapped their whole message in them
    # Handle cases like "Aye, the Colosseum..." -> Aye, the Colosseum...
    if (sanitized.startswith('"') and sanitized.endswith('"')) or \
       (sanitized.startswith("'") and sanitized.endswith("'")):
        sanitized = sanitized[1:-1].strip()

    # 3. Truncate accidental transcript continuations (multi-speaker artifacts).
    # We keep only the first utterance and drop injected sections like
    # "### User:", "Assistant:", or "### Devil's Advocate:".
    transcript_marker = re.compile(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:user|assistant|system|human|ai|agent|[A-Za-z][A-Za-z0-9'\- ]{1,40})\s*:\s*"
    )
    for match in transcript_marker.finditer(sanitized):
        if match.start() > 0:
            sanitized = sanitized[:match.start()].rstrip()
            break

    # 4. Remove trailing markdown header markers left after truncation.
    sanitized = re.sub(r"\n\s*#{2,}\s*$", "", sanitized).strip()

    return sanitized
