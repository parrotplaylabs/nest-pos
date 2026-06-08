PORT ?= 3848
PID_FILE := .nest-pos.pid
LOG_FILE := nest-pos.log

.PHONY: start stop restart status

start:
	@port_pid=$$(lsof -ti :$(PORT) 2>/dev/null); \
	if [ -n "$$port_pid" ] && [ -f $(PID_FILE) ] && [ "$$port_pid" = "$$(cat $(PID_FILE))" ]; then \
		echo "Already running at http://localhost:$(PORT) (PID $$port_pid)"; \
		exit 0; \
	fi; \
	if [ -n "$$port_pid" ]; then \
		echo "Port $(PORT) is in use by PID $$port_pid (another app?)."; \
		echo "Stop it first, or run: PORT=3849 make start"; \
		exit 1; \
	fi
	@PORT=$(PORT) nohup node server.js >> $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
	@sleep 0.5
	@if lsof -ti :$(PORT) >/dev/null 2>&1; then \
		echo "Started at http://localhost:$(PORT) (PID $$(cat $(PID_FILE)))"; \
	else \
		echo "Failed to start — check $(LOG_FILE):"; \
		tail -5 $(LOG_FILE) 2>/dev/null || true; \
		rm -f $(PID_FILE); \
		exit 1; \
	fi

stop:
	@if [ -f $(PID_FILE) ]; then \
		kill $$(cat $(PID_FILE)) 2>/dev/null || true; \
		rm -f $(PID_FILE); \
	fi
	@pid=$$(lsof -ti :$(PORT) 2>/dev/null); \
	if [ -n "$$pid" ]; then \
		kill $$pid 2>/dev/null || true; \
		echo "Stopped process on port $(PORT) (PID $$pid)"; \
	else \
		echo "Not running on port $(PORT)"; \
	fi

restart: stop start

status:
	@pid=$$(lsof -ti :$(PORT) 2>/dev/null); \
	if [ -n "$$pid" ]; then \
		echo "Running at http://localhost:$(PORT) (PID $$pid)"; \
	else \
		echo "Not running"; \
	fi
