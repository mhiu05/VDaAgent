import asyncio, time, sys
from src.services.repository import get_repository
from src.config import get_settings

async def main():
    repo = get_repository(get_settings())
    start = time.time()
    repo.full_profile('b234c27d4e1b504514ec8ab1e385355a')
    print(f'Done in {time.time()-start:.2f}s')

if __name__ == '__main__':
    asyncio.run(main())
