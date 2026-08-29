import os
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Float, Integer, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from dotenv import load_dotenv

load_dotenv()

USER = os.getenv("ORACLE_USER", "payroll_admin")
PASSWORD = os.getenv("ORACLE_PASSWORD", "your_secure_password")
HOST = os.getenv("ORACLE_HOST", "localhost")
PORT = os.getenv("ORACLE_PORT", "1521")
SERVICE = os.getenv("ORACLE_SERVICE", "XEPDB1")

DATABASE_URL = f"oracle+oracledb://{USER}:{PASSWORD}@{HOST}:{PORT}/?service_name={SERVICE}"

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Database Models ---
class EmployeeModel(Base):
    __tablename__ = "EMPLOYEES"
    id = Column("ID", String(64), primary_key=True, index=True)
    name = Column("NAME", String(255), nullable=False)
    role = Column("ROLE", String(255), default="")
    phone = Column("PHONE", String(50), default="")
    base_salary = Column("BASE_SALARY", Float, default=0.0)
    default_mode = Column("DEFAULT_MODE", String(50), default="Cash")
    created_at = Column("CREATED_AT", String(64))

class TransactionModel(Base):
    __tablename__ = "TRANSACTIONS"
    id = Column("ID", String(64), primary_key=True, index=True)
    employee_id = Column("EMPLOYEE_ID", String(64), ForeignKey("EMPLOYEES.ID", ondelete="CASCADE"), nullable=False)
    type = Column("TX_TYPE", String(50), nullable=False)
    amount = Column("AMOUNT", Float, nullable=False)
    date = Column("TX_DATE", String(20), nullable=False)
    mode = Column("PAYMENT_MODE", String(50), nullable=False)
    note = Column("NOTE", String(500), default="")
    salary_month = Column("SALARY_MONTH", Integer, nullable=True)
    salary_year = Column("SALARY_YEAR", Integer, nullable=True)
    created_at = Column("CREATED_AT", String(64))

Base.metadata.create_all(bind=engine)

# --- Schemas ---
class EmployeeBase(BaseModel):
    name: str
    role: Optional[str] = ""
    phone: Optional[str] = ""
    baseSalary: float = Field(0.0, ge=0)
    defaultMode: Optional[str] = "Cash"

class EmployeeCreate(EmployeeBase):
    id: Optional[str] = None

class EmployeeOut(EmployeeBase):
    id: str
    createdAt: Optional[str] = None

class TransactionBase(BaseModel):
    employeeId: str
    type: str
    amount: float = Field(..., gt=0)
    date: str
    mode: str
    note: Optional[str] = ""
    salaryMonth: Optional[int] = None
    salaryYear: Optional[int] = None

class TransactionCreate(TransactionBase):
    id: Optional[str] = None

class TransactionOut(TransactionBase):
    id: str
    createdAt: Optional[str] = None

# --- Application setup ---
app = FastAPI(title="Ledger API - Oracle Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Employee Endpoints ---
@app.get("/api/employees", response_model=List[EmployeeOut])
def get_employees(db: Session = Depends(get_db)):
    records = db.query(EmployeeModel).all()
    return [
        EmployeeOut(
            id=r.id,
            name=r.name,
            role=r.role,
            phone=r.phone,
            baseSalary=r.base_salary,
            defaultMode=r.default_mode,
            createdAt=r.created_at
        ) for r in records
    ]

@app.post("/api/employees", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)):
    emp_id = payload.id or f"emp_{uuid.uuid4().hex[:8]}"
    created_at = datetime.utcnow().isoformat()
    emp = EmployeeModel(
        id=emp_id,
        name=payload.name,
        role=payload.role,
        phone=payload.phone,
        base_salary=payload.baseSalary,
        default_mode=payload.defaultMode,
        created_at=created_at
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return EmployeeOut(
        id=emp.id, name=emp.name, role=emp.role, phone=emp.phone,
        baseSalary=emp.base_salary, defaultMode=emp.default_mode, createdAt=emp.created_at
    )

@app.put("/api/employees/{emp_id}", response_model=EmployeeOut)
def update_employee(emp_id: str, payload: EmployeeBase, db: Session = Depends(get_db)):
    emp = db.query(EmployeeModel).filter(EmployeeModel.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    emp.name = payload.name
    emp.role = payload.role
    emp.phone = payload.phone
    emp.base_salary = payload.baseSalary
    emp.default_mode = payload.defaultMode
    db.commit()
    return EmployeeOut(
        id=emp.id, name=emp.name, role=emp.role, phone=emp.phone,
        baseSalary=emp.base_salary, defaultMode=emp.default_mode, createdAt=emp.created_at
    )

@app.delete("/api/employees/{emp_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(emp_id: str, db: Session = Depends(get_db)):
    emp = db.query(EmployeeModel).filter(EmployeeModel.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    db.delete(emp)
    db.commit()
    return

# --- Transaction Endpoints ---
@app.get("/api/transactions", response_model=List[TransactionOut])
def get_transactions(db: Session = Depends(get_db)):
    records = db.query(TransactionModel).all()
    return [
        TransactionOut(
            id=r.id,
            employeeId=r.employee_id,
            type=r.type,
            amount=r.amount,
            date=r.date,
            mode=r.mode,
            note=r.note,
            salaryMonth=r.salary_month,
            salaryYear=r.salary_year,
            createdAt=r.created_at
        ) for r in records
    ]

@app.post("/api/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    if payload.type == "payment" and payload.salaryMonth and payload.salaryYear:
        existing = db.query(TransactionModel).filter(
            TransactionModel.employee_id == payload.employeeId,
            TransactionModel.type == "payment",
            TransactionModel.salary_year == payload.salaryYear,
            TransactionModel.salary_month == payload.salaryMonth
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Salary for {payload.salaryMonth}/{payload.salaryYear} already recorded."
            )

    tx_id = payload.id or f"tx_{uuid.uuid4().hex[:8]}"
    created_at = datetime.utcnow().isoformat()
    tx = TransactionModel(
        id=tx_id,
        employee_id=payload.employeeId,
        type=payload.type,
        amount=payload.amount,
        date=payload.date,
        mode=payload.mode,
        note=payload.note,
        salary_month=payload.salaryMonth,
        salary_year=payload.salaryYear,
        created_at=created_at
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return TransactionOut(
        id=tx.id, employeeId=tx.employee_id, type=tx.type, amount=tx.amount,
        date=tx.date, mode=tx.mode, note=tx.note,
        salaryMonth=tx.salary_month, salaryYear=tx.salary_year, createdAt=tx.created_at
    )

@app.delete("/api/transactions/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(tx_id: str, db: Session = Depends(get_db)):
    tx = db.query(TransactionModel).filter(TransactionModel.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(tx)
    db.commit()
    return