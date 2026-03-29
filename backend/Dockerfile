FROM python:3.11-slim

WORKDIR /app

# Install uv for fast dependency management
RUN pip install uv

COPY . .
RUN uv pip install --system -r requirements.txt

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
