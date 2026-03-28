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
        rf"^\s*[\"']?{re.escape(agent_name)}[:\-\s—]+\s*[\"']?",
        rf"^\s*[\"']?Agent[:\-\s—]+\s*[\"']?",
        rf"^\s*[\"']?Response[:\-\s—]+\s*[\"']?",
    ]
    
    for pattern in prefix_patterns:
        sanitized = re.sub(pattern, "", sanitized, flags=re.IGNORECASE).strip()
    
    # 2. Strip surrounding bulk quotes if the agent wrapped their whole message in them
    # Handle cases like "Aye, the Colosseum..." -> Aye, the Colosseum...
    if (sanitized.startswith('"') and sanitized.endswith('"')) or \
       (sanitized.startswith("'") and sanitized.endswith("'")):
        sanitized = sanitized[1:-1].strip()
        
    return sanitized
