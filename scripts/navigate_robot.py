#!/usr/bin/env python3
"""Navigate a TurtleBot3 to a target (x, y) using simple proportional control.

Usage (inside WSL):
    python3 navigate_robot.py --robot-id robot_1 --target-x 9.5 --target-y 8.0
"""

import math
import sys
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry


class NavigateNode(Node):
    def __init__(self, robot_id: str, target_x: float, target_y: float):
        super().__init__(f"{robot_id}_navigator")
        self.robot_id = robot_id
        self.target_x = target_x
        self.target_y = target_y
        self._arrived = False

        self.current_x = 0.0
        self.current_y = 0.0
        self.current_yaw = 0.0
        self.got_first_odom = False

        self.pub = self.create_publisher(Twist, f"/{robot_id}/cmd_vel", 10)
        self.sub = self.create_subscription(Odometry, f"/{robot_id}/odom", self.odom_cb, 10)

        # Control parameters
        self.Kp_lin = 0.5
        self.Kp_ang = 1.5
        self.goal_tol = 0.3
        self.yaw_tol = 0.15

        self.timer = self.create_timer(0.1, self.control_loop)

    def odom_cb(self, msg: Odometry):
        self.current_x = msg.pose.pose.position.x
        self.current_y = msg.pose.pose.position.y
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.current_yaw = math.atan2(siny, cosy)
        self.got_first_odom = True

    def control_loop(self):
        if self._arrived or not self.got_first_odom:
            return

        dx = self.target_x - self.current_x
        dy = self.target_y - self.current_y
        dist = math.sqrt(dx * dx + dy * dy)

        if dist < self.goal_tol:
            self.pub.publish(Twist())
            self.get_logger().info(
                f"[{self.robot_id}] Arrived at ({self.target_x:.1f}, {self.target_y:.1f})"
            )
            self._arrived = True
            return

        target_yaw = math.atan2(dy, dx)
        yaw_err = self._normalize_angle(target_yaw - self.current_yaw)

        cmd = Twist()
        if abs(yaw_err) > self.yaw_tol:
            cmd.angular.z = self.Kp_ang * yaw_err
            cmd.linear.x = 0.0
        else:
            cmd.linear.x = min(self.Kp_lin * dist, 0.3)
            cmd.angular.z = self.Kp_ang * yaw_err

        self.pub.publish(cmd)

    @property
    def arrived(self) -> bool:
        return self._arrived

    @staticmethod
    def _normalize_angle(a: float) -> float:
        while a > math.pi:
            a -= 2 * math.pi
        while a < -math.pi:
            a += 2 * math.pi
        return a


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--robot-id", default="robot_1")
    parser.add_argument("--target-x", type=float, required=True)
    parser.add_argument("--target-y", type=float, required=True)
    args = parser.parse_args()

    rclpy.init()
    node = NavigateNode(args.robot_id, args.target_x, args.target_y)

    try:
        while rclpy.ok() and not node.arrived:
            rclpy.spin_once(node, timeout_sec=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        node.pub.publish(Twist())
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
