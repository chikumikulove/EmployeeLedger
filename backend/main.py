import os
import uuid
from datetime import datetime
from typing import List, Optional
from urllib.parse import quote
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, String, Float, Integer, ForeignKey, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from dotenv import load_dotenv

load_dotenv()

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "ledger_db")

DATABASE_URL = f"postgresql://{DB_USER}:{quote(DB_PASSWORD, safe='')}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- Database Models ---
class EmployeeModel(Base):
    __tablename__ = "employees"
    id = Column("id", String(64), primary_key=True, index=True)
    name = Column("name", String(255), nullable=False)
    role = Column("role", String(255), default="")
    phone = Column("phone", String(50), default="")
    base_salary = Column("base_salary", Float, default=0.0)
    default_mode = Column("default_mode", String(50), default="Cash")
    joining_month = Column("joining_month", Integer, default=1)
    joining_year = Column("joining_year", Integer, default=2024)
    created_at = Column("created_at", String(64))

class TransactionModel(Base):
    __tablename__ = "transactions"
    id = Column("id", String(64), primary_key=True, index=True)
    employee_id = Column("employee_id", String(64), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    type = Column("tx_type", String(50), nullable=False)
    amount = Column("amount", Float, nullable=False)
    date = Column("tx_date", String(20), nullable=False)
    mode = Column("payment_mode", String(50), nullable=False)
    note = Column("note", String(500), default="")
    salary_month = Column("salary_month", Integer, nullable=True)
    salary_year = Column("salary_year", Integer, nullable=True)
    created_at = Column("created_at", String(64))

Base.metadata.create_all(bind=engine)

# --- Auto-migration: Add missing columns ---
def run_migrations():
    db = SessionLocal()
    try:
        inspector = inspect(engine)
        employees_columns = [col['name'] for col in inspector.get_columns('employees')]
        
        # Add joining_month if missing
        if 'joining_month' not in employees_columns:
            db.execute(text('ALTER TABLE employees ADD COLUMN joining_month INTEGER DEFAULT 1'))
            db.commit()
        
        # Add joining_year if missing
        if 'joining_year' not in employees_columns:
            db.execute(text('ALTER TABLE employees ADD COLUMN joining_year INTEGER DEFAULT 2024'))
            db.commit()
    except Exception as e:
        print(f"Migration error: {e}")
        db.rollback()
    finally:
        db.close()

run_migrations()

# --- Schemas ---
class EmployeeBase(BaseModel):
    name: str
    role: Optional[str] = ""
    phone: Optional[str] = ""
    baseSalary: float = Field(0.0, ge=0)
    defaultMode: Optional[str] = "Cash"
    joiningMonth: Optional[int] = 1
    joiningYear: Optional[int] = 2024

class EmployeeCreate(EmployeeBase):
    id: Optional[str] = None

class EmployeeOut(EmployeeBase):
    id: str
    createdAt: Optional[str] = None
    joiningMonth: int
    joiningYear: int

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
app = FastAPI(title="Ledger API - PostgreSQL Backend")

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
            joiningMonth=r.joining_month,
            joiningYear=r.joining_year,
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
        joining_month=payload.joiningMonth,
        joining_year=payload.joiningYear,
        created_at=created_at
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return EmployeeOut(
        id=emp.id, name=emp.name, role=emp.role, phone=emp.phone,
        baseSalary=emp.base_salary, defaultMode=emp.default_mode,
        joiningMonth=emp.joining_month, joiningYear=emp.joining_year, createdAt=emp.created_at
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
    emp.joining_month = payload.joiningMonth
    emp.joining_year = payload.joiningYear
    db.commit()
    return EmployeeOut(
        id=emp.id, name=emp.name, role=emp.role, phone=emp.phone,
        baseSalary=emp.base_salary, defaultMode=emp.default_mode,
        joiningMonth=emp.joining_month, joiningYear=emp.joining_year, createdAt=emp.created_at
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
    
@app.get("/api/employees/{emp_id}/summary")
def get_employee_ledger_summary(emp_id: str, db: Session = Depends(get_db)):
    emp = db.query(EmployeeModel).filter(EmployeeModel.id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    txs = db.query(TransactionModel).filter(TransactionModel.employee_id == emp_id).all()

    paid = sum(t.amount for t in txs if t.type == "payment")
    adv_given = sum(t.amount for t in txs if t.type == "advance")
    adv_repaid = sum(t.amount for t in txs if t.type == "deduction")
    explicit_credit = sum(t.amount for t in txs if t.type == "credit")

    base_salary = float(emp.base_salary or 0.0)
    joining_month = emp.joining_month or 1
    joining_year = emp.joining_year or datetime.utcnow().year

    overpaid_advance = 0.0
    underpaid_salary = 0.0

    for t in txs:
        if t.type == "payment" and t.salary_year and t.salary_month:
            if (t.salary_year > joining_year) or (t.salary_year == joining_year and t.salary_month >= joining_month):
                if t.amount > base_salary:
                    overpaid_advance += (t.amount - base_salary)
                elif t.amount < base_salary:
                    underpaid_salary += (base_salary - t.amount)

    net_advance = max(0.0, adv_given - adv_repaid)
    outstanding_advance = net_advance + overpaid_advance
    total_credit = explicit_credit + underpaid_salary

    available_to_pay = base_salary + total_credit
    overrun = outstanding_advance - available_to_pay

    expected_salary = 0.0 if overrun > 0 else (available_to_pay - outstanding_advance)
    excess_as_credit = overrun if overrun > 0 else 0.0

    return {
        "paid": round(paid, 2),
        "outstandingAdvance": round(outstanding_advance, 2),
        "credit": round(explicit_credit, 2),
        "underpaidSalary": round(underpaid_salary, 2),
        "overpaidAdvance": round(overpaid_advance, 2),
        "totalCredit": round(total_credit, 2),
        "expectedSalary": round(expected_salary, 2),
        "excessAsCredit": round(excess_as_credit, 2),
        "txCount": len(txs)
    }