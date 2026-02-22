import psycopg2

conn = psycopg2.connect(
    host='193.135.153.250',
    port=5432,
    dbname='nwow',
    user='trigonet',
    password='m2RL3WLVgRNZr',
    connect_timeout=5
)
cur = conn.cursor()

cur.execute('SELECT version()')
print('PostgreSQL:', cur.fetchone()[0])

cur.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'mapplusconf'")
r = cur.fetchone()
print('Schema mapplusconf:', 'EXISTS' if r else 'NOT FOUND')

if r:
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'mapplusconf' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    """)
    tables = cur.fetchall()
    print(f'Tabellen ({len(tables)}):')
    for t in tables:
        print(f'  - {t[0]}')

conn.close()
