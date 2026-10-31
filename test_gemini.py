
import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
model = os.getenv("GEMINI_MODEL")

client = genai.Client(api_key=api_key)

response = client.models.generate_content(
    model=model,
    contents="Explique brièvement ce qu'est un système bancaire RAG."
)

print("\nRéponse de Gemini :\n")
print(response.text)
