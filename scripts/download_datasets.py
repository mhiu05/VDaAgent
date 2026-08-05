import os
import urllib.request

base_dir = r"d:\ai20k\P-170\docs\dataset"

# 1. SQLite Chinook Database
dir_sqlite = os.path.join(base_dir, "sqlite_chinook")
os.makedirs(dir_sqlite, exist_ok=True)
url_chinook = "https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_Sqlite.sqlite"
req = urllib.request.Request(url_chinook, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as resp, open(os.path.join(dir_sqlite, "Chinook_Sqlite.sqlite"), "wb") as f:
    f.write(resp.read())
print("Downloaded Chinook SQLite Database")

# 2. Relational Jaffle Shop (Multi-table e-commerce CSV set with FK relations)
dir_jaffle = os.path.join(base_dir, "relational_jaffle_shop")
os.makedirs(dir_jaffle, exist_ok=True)
jaffle_files = {
    "raw_customers.csv": "https://raw.githubusercontent.com/dbt-labs/jaffle-shop-classic/main/seeds/raw_customers.csv",
    "raw_orders.csv": "https://raw.githubusercontent.com/dbt-labs/jaffle-shop-classic/main/seeds/raw_orders.csv",
    "raw_payments.csv": "https://raw.githubusercontent.com/dbt-labs/jaffle-shop-classic/main/seeds/raw_payments.csv"
}
for name, url in jaffle_files.items():
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp, open(os.path.join(dir_jaffle, name), "wb") as f:
        f.write(resp.read())
print("Downloaded Relational Jaffle Shop CSVs")

# 3. Dirty Datasets for Robustness & Quality Testing
dir_dirty = os.path.join(base_dir, "dirty_datasets")
os.makedirs(dir_dirty, exist_ok=True)
dirty_files = {
    "auto_imports_dirty.csv": "https://raw.githubusercontent.com/jbrownlee/Datasets/master/auto_imports.csv",
    "horse_colic_dirty.csv": "https://raw.githubusercontent.com/jbrownlee/Datasets/master/horse-colic.csv"
}
for name, url in dirty_files.items():
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp, open(os.path.join(dir_dirty, name), "wb") as f:
        f.write(resp.read())

cafe_sales_content = (
    "transaction_id,item,quantity,price_per_unit,total_spent,payment_method,location,transaction_date\n"
    "TX1001,Coffee,2,$3.50,$7.00,Credit Card,In-store,2024-01-15\n"
    "TX1002,Cake,1,5.00,5.00,Cash,Takeaway,15/01/2024\n"
    "TX1001,Coffee,2,3.50,10.00,ERROR,In-store,01-15-2024\n"
    "TX1004,Cookie,UNKNOWN,-2.00,-4.00,Credit Card,Takeaway,2024-02-31\n"
    "TX1005,Espresso,3,4.00,15.00,Cash,,9999-99-99\n"
    "TX1006,Tea,?,2.50,?,Cash,In-store,2024/03/10\n"
)
with open(os.path.join(dir_dirty, "dirty_cafe_sales.csv"), "w", encoding="utf-8") as f:
    f.write(cafe_sales_content)
print("Created Dirty Datasets")

# 4. Parquet Samples
dir_parquet = os.path.join(base_dir, "parquet_sample")
os.makedirs(dir_parquet, exist_ok=True)
parquet_files = {
    "alltypes_plain.parquet": "https://raw.githubusercontent.com/apache/parquet-testing/master/data/alltypes_plain.parquet",
    "nested_lists.snappy.parquet": "https://raw.githubusercontent.com/apache/parquet-testing/master/data/nested_lists.snappy.parquet"
}
for name, url in parquet_files.items():
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp, open(os.path.join(dir_parquet, name), "wb") as f:
        f.write(resp.read())
print("Downloaded Parquet Samples")

# 5. JSONL Samples
dir_jsonl = os.path.join(base_dir, "jsonl_sample")
os.makedirs(dir_jsonl, exist_ok=True)
jsonl_content = (
    '{"business_id": "b101", "name": "Pho 79", "city": "Hanoi", "attributes": {"GoodForKids": true, "PriceRange": 2}, "stars": 4.5}\n'
    '{"business_id": "b102", "name": "Highlands Coffee", "city": "HCM", "attributes": {"PriceRange": "medium"}, "stars": "four"}\n'
    '{"business_id": "b103", "name": "Banh Mi Huynh Hoa", "stars": 5.0}\n'
)
with open(os.path.join(dir_jsonl, "sample_business_reviews.jsonl"), "w", encoding="utf-8") as f:
    f.write(jsonl_content)
print("Created JSONL Sample")
