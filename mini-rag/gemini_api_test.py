import google.generativeai as genai
from dotenv import load_dotenv
import os

load_dotenv()

# configure with your API key

api_key = os.getenv("GOOGLE_API_KEY")
model_name = os.getenv("GEMINI_MODEL")

genai.configure(api_key=api_key)

model = genai.GenerativeModel(model_name=model_name)

response = model.generate_content("Hello Gemini!")
print(response.text)
