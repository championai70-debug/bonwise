FROM python:3.11-slim

# Tesseract with German + English is the backup reader when the AI can't answer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .
USER user

ENV PORT=7860 PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["python", "app.py"]
