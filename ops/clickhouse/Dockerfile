FROM clickhouse/clickhouse-server:26.8.3.105

USER root

RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/hifld-udf-requirements.txt
RUN python3 -m venv /opt/hifld-udf \
    && /opt/hifld-udf/bin/pip install --no-cache-dir -r /tmp/hifld-udf-requirements.txt \
    && rm /tmp/hifld-udf-requirements.txt

COPY --chmod=0555 hifld_reproject_wkb.py /opt/hifld-user-scripts/hifld_reproject_wkb.py
COPY hifld_reproject_wkb_function.xml /etc/clickhouse-server/hifld_reproject_wkb_function.xml
COPY config.d/filesystem-cache.xml /etc/clickhouse-server/config.d/filesystem-cache.xml
COPY users.d/query-user.xml /etc/clickhouse-server/users.d/query-user.xml

ENV CLICKHOUSE_MAX_CONCURRENT_QUERIES=2

USER clickhouse
