import os
import sys
# Add current directory to path to find app
sys.path.append('/Users/jweisz/Documents/Code/tft-arena/backend')
from app.models.db import DATABASE_URL, engine
from sqlalchemy import inspect

print(f"DATABASE_URL used by app: {DATABASE_URL}")
print(f"Tables in the DB according to engine:")
inspector = inspect(engine)
tables = inspector.get_table_names()
for table in tables:
    count_res = engine.connect().execute(f"SELECT count(*) FROM {table}")
    count = count_res.scalar()
    print(f"  - {table}: {count} rows")
