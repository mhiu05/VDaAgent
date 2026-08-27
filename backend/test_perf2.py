import asyncio, time
from src.services.repository import get_repository
from src.config import get_settings

async def main():
    repo = get_repository(get_settings())
    run_id = 'b234c27d4e1b504514ec8ab1e385355a'
    
    for step, func in [('run', repo.get_profile_run), ('props', repo.get_proposals), ('stats', repo.column_stats_rows), ('tests', repo.get_test_results), ('drift', repo.get_drift_reports)]:
        s = time.time()
        func(run_id)
        print(f'{step}: {time.time()-s:.2f}s')

if __name__ == '__main__':
    asyncio.run(main())
