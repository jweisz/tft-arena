import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

# In production this should be stored safely in env vars
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "super-secret-tft-arena-key-for-local-dev")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 days
ALLOWED_USER_EMAIL = os.environ.get("ALLOWED_USER_EMAIL", "")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    # If no allowed email is set, we bypass auth for local open testing
    if not ALLOWED_USER_EMAIL:
        return {"email": "local_dev@localhost"}
        
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None or email.lower() != ALLOWED_USER_EMAIL.lower():
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return {"email": email}
