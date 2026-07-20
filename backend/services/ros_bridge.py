"""ROS 2 → WebSocket bridge.

UNUSED — This module is not imported anywhere in the application.
It was developed as a placeholder for future ROS 2 integration.
See ADR for decision to defer ROS 2 bridge until simulation is stable.
"""

import asyncio
import json
import logging
import threading
import time
from typing import Optional

from ..models.robot import WSMessage, WSMessageType

logger = logging.getLogger(__name__)

try:
    import rclpy
    from rclpy.node import Node
    from std_msgs.msg import String

    ROS2_AVAILABLE = True
except ImportError:
    ROS2_AVAILABLE = False
    logger.warning("rclpy not available. ROS 2 bridge disabled.")


class ROS2BridgeNode(Node):
    """Minimal ROS 2 node that subscribes to /fleet_status."""

    def __init__(self, queue: asyncio.Queue):
        super().__init__("ros_bridge")
        self._queue = queue
        self.sub = self.create_subscription(
            String, "/fleet_status", self._callback, 10
        )
        self.get_logger().info("ROS 2 bridge subscribed to /fleet_status")

    def _callback(self, msg: String) -> None:
        """Push received message to asyncio queue (thread-safe)."""
        try:
            data = json.loads(msg.data)
        except (json.JSONDecodeError, TypeError):
            data = {"raw": msg.data}

        # Push via coroutine — thread-safe
        coro = self._queue.put(data)
        fut = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            fut.result(timeout=1.0)
        except Exception:
            pass


class ROS2Bridge:
    """Manages the ROS 2 background thread and the asyncio message queue.

    Usage:
        bridge = ROS2Bridge()
        bridge.start()          # Starts background rclpy thread
        msg = await bridge.get_message()  # Read from queue
        bridge.stop()           # Clean shutdown
    """

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._node: Optional[ROS2BridgeNode] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @property
    def queue(self) -> asyncio.Queue:
        return self._queue

    def start(self) -> None:
        """Start the ROS 2 bridge background thread.

        Must be called from the main async event loop thread.
        """
        if not ROS2_AVAILABLE:
            logger.info("Starting in stub mode (no rclpy)")
            self._running = True
            return

        self._running = True
        self._loop = asyncio.get_event_loop()
        self._thread = threading.Thread(target=self._run_spin, daemon=True)
        self._thread.start()
        logger.info("ROS 2 bridge thread started")

    def stop(self) -> None:
        """Stop the ROS 2 bridge thread."""
        self._running = False
        if ROS2_AVAILABLE and rclpy.ok():
            try:
                if self._node:
                    self._node.destroy_node()
                rclpy.shutdown()
            except Exception as e:
                logger.info("Shutdown error: %s", e)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        logger.info("ROS 2 bridge stopped")

    async def get_message(self, timeout: float = 5.0) -> Optional[dict]:
        """Read next message from the queue with timeout.

        Returns None on timeout (caller should send heartbeat).
        """
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    def _run_spin(self) -> None:
        """Background thread: init rclpy and spin the bridge node."""
        try:
            rclpy.init()
            self._node = ROS2BridgeNode(self._queue)
            # Store loop reference for thread-safe callbacks
            self._node._loop = self._loop
            while rclpy.ok() and self._running:
                rclpy.spin_once(self._node, timeout_sec=0.1)
        except Exception as e:
            logger.info("Thread error: %s", e)
        finally:
            if rclpy.ok():
                rclpy.shutdown()
