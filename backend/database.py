import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DB_PATH = os.environ.get("DATABASE_URL", "sqlite:///./adaptirag.db")

engine = create_engine(
    DB_PATH,
    # timeout: wait up to 30 s for a locked SQLite file (e.g. graph build running while you chat)
    connect_args={"check_same_thread": False, "timeout": 30} if DB_PATH.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()